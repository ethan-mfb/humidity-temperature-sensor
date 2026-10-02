/*
 * DHT22/AM2302 single-frame edge capture, libgpiod v2.
 *
 * Timing-critical companion to capture-sensor.mjs. Performs exactly one
 * triggered read and exits: drives the host start signal, releases the line,
 * and prints every edge the sensor produces with the kernel's own timestamp.
 *
 * It does not interpret the signal and it does not decide when to read; the
 * calling script owns sampling, output and analysis.
 *
 * Why this is C and not a Node binding: the frame must be captured by a single
 * process that never releases the line. libgpiod requests own their lines
 * exclusively, so driving the start pulse and then listening for edges has to
 * happen across one reconfigure of one request. No published Node binding
 * exposes gpiod_line_request_reconfigure_lines(), the kernel edge timestamp, or
 * the request's event buffer size, and all three are required here.
 *
 * Build:
 *   gcc -O2 -Wall -Wextra -std=gnu17 -o gpiod-capture gpiod-capture.c \
 *     $(pkg-config --cflags --libs libgpiod)
 *
 * -std=gnu17 is a no-op on trixie's gcc 14, which defaults to it. It is pinned so a build on
 * a newer compiler cannot silently raise the binary's glibc floor: gcc 15 defaults to C23 and
 * remaps strtoul to __isoc23_strtoul, which needs glibc 2.38 rather than 2.34.
 *
 * Output (stdout), one edge per line, whitespace separated:
 *   <level> <timestamp_ns>
 * where level is the logic level *after* the transition and timestamp_ns is
 * CLOCK_MONOTONIC nanoseconds, directly comparable across invocations.
 * Diagnostics go to stderr. Exit status 0 means the read completed, even if it
 * produced no edges: an empty frame is data, not a failure.
 */

#define _POSIX_C_SOURCE 200809L

#include <dirent.h>
#include <inttypes.h>
#include <limits.h>
#include <errno.h>
#include <gpiod.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Host-side signalling constants from the AM2302 datasheet. */
#define START_SIGNAL_LOW_US_DEFAULT 5000
#define FRAME_WINDOW_MS_DEFAULT 25

/*
 * The kernel buffers edge events in a kfifo sized at request time. A complete
 * frame is 85 edges; oversizing this is what lets the timestamps stay accurate
 * when userspace is scheduled late, so never tune it down to "just enough".
 */
#define EVENT_BUFFER_CAPACITY 256

#define SETTLE_BEFORE_PULSE_US 1000
#define DEV_DIR "/dev"
#define GPIOCHIP_PREFIX "gpiochip"
#define DEFAULT_CHIP_LABEL "pinctrl-bcm2835"
#define CONSUMER "dht22-capture"

#define NS_PER_US 1000ULL
#define NS_PER_MS 1000000ULL
#define US_PER_MS 1000ULL

#define EXIT_USAGE 2

typedef struct {
  const char *chip_path;
  const char *chip_label;
  unsigned int line_offset;
  unsigned long start_signal_low_us;
  unsigned long frame_window_ms;
} options;

static uint64_t now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000000000ULL + (uint64_t)ts.tv_nsec;
}

/*
 * The start pulse is specified in microseconds, which is below the resolution
 * nanosleep() can be relied on for here, so it is spun out deliberately.
 */
static void busy_wait_us(unsigned long microseconds) {
  const uint64_t deadline = now_ns() + (uint64_t)microseconds * NS_PER_US;
  while (now_ns() < deadline) {
    /* intentionally spinning */
  }
}

/*
 * Resolves a chip by its label rather than its number. Chip numbering is not
 * stable across kernels or boards, but the pi header controller consistently
 * reports pinctrl-bcm2835. Returns a malloc'd path, or NULL if no chip matches.
 */
static char *find_chip_by_label(const char *label) {
  DIR *dev = opendir(DEV_DIR);
  if (dev == NULL) {
    return NULL;
  }

  char *found = NULL;
  struct dirent *entry;

  while (found == NULL && (entry = readdir(dev)) != NULL) {
    if (strncmp(entry->d_name, GPIOCHIP_PREFIX, strlen(GPIOCHIP_PREFIX)) != 0) {
      continue;
    }

    char path[PATH_MAX];
    snprintf(path, sizeof(path), DEV_DIR "/%s", entry->d_name);

    struct gpiod_chip *chip = gpiod_chip_open(path);
    if (chip == NULL) {
      continue;
    }

    struct gpiod_chip_info *info = gpiod_chip_get_info(chip);
    if (info != NULL) {
      if (strcmp(gpiod_chip_info_get_label(info), label) == 0) {
        found = strdup(path);
      }
      gpiod_chip_info_free(info);
    }
    gpiod_chip_close(chip);
  }

  closedir(dev);
  return found;
}

/* Builds a one-line config. Returns NULL on allocation failure. */
static struct gpiod_line_config *build_line_config(
    unsigned int offset, enum gpiod_line_direction direction,
    enum gpiod_line_edge edge, enum gpiod_line_bias bias,
    enum gpiod_line_value output_value) {
  struct gpiod_line_settings *settings = gpiod_line_settings_new();
  if (settings == NULL) {
    return NULL;
  }

  gpiod_line_settings_set_direction(settings, direction);
  gpiod_line_settings_set_edge_detection(settings, edge);
  gpiod_line_settings_set_bias(settings, bias);
  gpiod_line_settings_set_output_value(settings, output_value);

  struct gpiod_line_config *config = gpiod_line_config_new();
  if (config == NULL) {
    gpiod_line_settings_free(settings);
    return NULL;
  }

  const int added =
      gpiod_line_config_add_line_settings(config, &offset, 1, settings);
  gpiod_line_settings_free(settings);

  if (added != 0) {
    gpiod_line_config_free(config);
    return NULL;
  }

  return config;
}

/*
 * Drains edge events until the frame window closes. Prints as it goes so a
 * partial frame still reaches the caller. Returns the number of edges printed.
 */
static unsigned long drain_edges(struct gpiod_line_request *request,
                                 unsigned long frame_window_ms) {
  struct gpiod_edge_event_buffer *buffer =
      gpiod_edge_event_buffer_new(EVENT_BUFFER_CAPACITY);
  if (buffer == NULL) {
    fprintf(stderr, "failed to allocate edge event buffer\n");
    return 0;
  }

  const uint64_t deadline = now_ns() + (uint64_t)frame_window_ms * NS_PER_MS;
  unsigned long printed = 0;

  while (now_ns() < deadline) {
    const int64_t remaining_ns = (int64_t)(deadline - now_ns());
    const int waited =
        gpiod_line_request_wait_edge_events(request, remaining_ns);

    if (waited < 0) {
      if (errno == EINTR) {
        continue;
      }
      fprintf(stderr, "wait_edge_events failed: %s\n", strerror(errno));
      break;
    }

    if (waited == 0) {
      break; /* window closed with nothing further from the sensor */
    }

    const int count = gpiod_line_request_read_edge_events(
        request, buffer, EVENT_BUFFER_CAPACITY);
    if (count < 0) {
      fprintf(stderr, "read_edge_events failed: %s\n", strerror(errno));
      break;
    }

    for (int index = 0; index < count; index += 1) {
      struct gpiod_edge_event *event =
          gpiod_edge_event_buffer_get_event(buffer, (unsigned long)index);
      const int level = gpiod_edge_event_get_event_type(event) ==
                                GPIOD_EDGE_EVENT_RISING_EDGE
                            ? 1
                            : 0;
      printf("%d %" PRIu64 "\n", level,
             (uint64_t)gpiod_edge_event_get_timestamp_ns(event));
      printed += 1;
    }
  }

  gpiod_edge_event_buffer_free(buffer);
  return printed;
}

static void print_usage(void) {
  fprintf(stderr,
          "Capture one DHT22/AM2302 frame via libgpiod v2.\n\n"
          "  gpiod-capture --line <offset> [options]\n\n"
          "  --line <offset>     BCM GPIO number (character device offsets are "
          "BCM numbers)\n"
          "  --chip <path>       Explicit chip, e.g. /dev/gpiochip0 "
          "(default: resolve by label)\n"
          "  --chip-label <s>    Chip label to resolve (default: %s)\n"
          "  --start-low-us <n>  Start signal low time (default: %d)\n"
          "  --frame-window-ms <n>  Listen window after release (default: %d)\n"
          "  --help              Show this message\n",
          DEFAULT_CHIP_LABEL, START_SIGNAL_LOW_US_DEFAULT,
          FRAME_WINDOW_MS_DEFAULT);
}

/* Returns 0 on success, EXIT_USAGE on a bad argument list. */
static int parse_options(int argc, char **argv, options *parsed) {
  int has_line = 0;

  for (int index = 1; index < argc; index += 1) {
    const char *flag = argv[index];
    const char *value = (index + 1 < argc) ? argv[index + 1] : NULL;

    if (strcmp(flag, "--help") == 0) {
      return EXIT_USAGE;
    }
    if (value == NULL) {
      fprintf(stderr, "missing value for %s\n", flag);
      return EXIT_USAGE;
    }

    if (strcmp(flag, "--line") == 0) {
      parsed->line_offset = (unsigned int)strtoul(value, NULL, 10);
      has_line = 1;
    } else if (strcmp(flag, "--chip") == 0) {
      parsed->chip_path = value;
    } else if (strcmp(flag, "--chip-label") == 0) {
      parsed->chip_label = value;
    } else if (strcmp(flag, "--start-low-us") == 0) {
      parsed->start_signal_low_us = strtoul(value, NULL, 10);
    } else if (strcmp(flag, "--frame-window-ms") == 0) {
      parsed->frame_window_ms = strtoul(value, NULL, 10);
    } else {
      fprintf(stderr, "unknown option %s\n", flag);
      return EXIT_USAGE;
    }

    index += 1;
  }

  if (has_line == 0) {
    fprintf(stderr, "--line is required\n");
    return EXIT_USAGE;
  }

  return 0;
}

int main(int argc, char **argv) {
  options parsed = {
      .chip_path = NULL,
      .chip_label = DEFAULT_CHIP_LABEL,
      .line_offset = 0,
      .start_signal_low_us = START_SIGNAL_LOW_US_DEFAULT,
      .frame_window_ms = FRAME_WINDOW_MS_DEFAULT,
  };

  if (parse_options(argc, argv, &parsed) != 0) {
    print_usage();
    return EXIT_USAGE;
  }

  char *resolved_path = NULL;
  const char *chip_path = parsed.chip_path;

  if (chip_path == NULL) {
    resolved_path = find_chip_by_label(parsed.chip_label);
    if (resolved_path == NULL) {
      fprintf(stderr,
              "no gpiochip with label \"%s\"; pass --chip explicitly\n",
              parsed.chip_label);
      return EXIT_FAILURE;
    }
    chip_path = resolved_path;
  }

  struct gpiod_chip *chip = gpiod_chip_open(chip_path);
  if (chip == NULL) {
    fprintf(stderr, "failed to open %s: %s\n", chip_path, strerror(errno));
    free(resolved_path);
    return EXIT_FAILURE;
  }

  /*
   * Request the line already driving high, so the sensor sees a clean idle
   * level before the start signal rather than whatever the bus was left at.
   */
  struct gpiod_line_config *output_config = build_line_config(
      parsed.line_offset, GPIOD_LINE_DIRECTION_OUTPUT, GPIOD_LINE_EDGE_NONE,
      GPIOD_LINE_BIAS_AS_IS, GPIOD_LINE_VALUE_ACTIVE);

  /*
   * Releasing the line back to input is what the sensor reads as the end of the
   * start signal, so the pull-up is enabled in the same reconfigure. Physical
   * pin 3 also carries a 1.8k hardware pull-up, which is the one actually doing
   * the work; the internal pull-up is a fallback for other pins.
   */
  struct gpiod_line_config *input_config = build_line_config(
      parsed.line_offset, GPIOD_LINE_DIRECTION_INPUT, GPIOD_LINE_EDGE_BOTH,
      GPIOD_LINE_BIAS_PULL_UP, GPIOD_LINE_VALUE_INACTIVE);

  struct gpiod_request_config *request_config = gpiod_request_config_new();

  if (output_config == NULL || input_config == NULL ||
      request_config == NULL) {
    fprintf(stderr, "failed to build line configuration\n");
    gpiod_chip_close(chip);
    free(resolved_path);
    return EXIT_FAILURE;
  }

  gpiod_request_config_set_consumer(request_config, CONSUMER);
  gpiod_request_config_set_event_buffer_size(request_config,
                                             EVENT_BUFFER_CAPACITY);

  struct gpiod_line_request *request =
      gpiod_chip_request_lines(chip, request_config, output_config);

  if (request == NULL) {
    fprintf(stderr, "failed to request line %u on %s: %s\n",
            parsed.line_offset, chip_path, strerror(errno));
    if (errno == EACCES) {
      fprintf(stderr, "hint: add the user to the gpio group\n");
    }
    if (errno == EBUSY) {
      fprintf(stderr,
              "hint: another consumer holds the line; a dht11/dht22 overlay "
              "in /boot/firmware/config.txt will do this\n");
    }
    gpiod_request_config_free(request_config);
    gpiod_line_config_free(output_config);
    gpiod_line_config_free(input_config);
    gpiod_chip_close(chip);
    free(resolved_path);
    return EXIT_FAILURE;
  }

  busy_wait_us(SETTLE_BEFORE_PULSE_US);

  /* Start signal: hold low, then hand the line back to the sensor. */
  gpiod_line_request_set_value(request, parsed.line_offset,
                               GPIOD_LINE_VALUE_INACTIVE);
  busy_wait_us(parsed.start_signal_low_us);

  const int reconfigured =
      gpiod_line_request_reconfigure_lines(request, input_config);

  unsigned long edges = 0;
  int status = EXIT_SUCCESS;

  if (reconfigured != 0) {
    fprintf(stderr, "failed to release line to input: %s\n", strerror(errno));
    status = EXIT_FAILURE;
  } else {
    edges = drain_edges(request, parsed.frame_window_ms);
  }

  fprintf(stderr, "captured %lu edge(s) on %s line %u\n", edges, chip_path,
          parsed.line_offset);

  gpiod_line_request_release(request);
  gpiod_request_config_free(request_config);
  gpiod_line_config_free(output_config);
  gpiod_line_config_free(input_config);
  gpiod_chip_close(chip);
  free(resolved_path);

  return status;
}
