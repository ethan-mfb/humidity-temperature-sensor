# Temp Sensor Service

A high-level service that leverages the GPIO Pin Service to interact with the AM2302 (DHT22) temperature and humidity sensor on the Raspberry Pi Zero 2.

## Responsibilities

- **Data Transformation:**  
  Transform raw data received from the GPIO Pin Service (representing AM2302 sensor signals) into meaningful, application-friendly values.
- **Signal Decoding:**  
  Parse and interpret the digital signal according to the [AM2302/DHT22 datasheet](assets/DHT22-AM2302-Datasheet.pdf), extracting temperature and humidity readings.
- **Unit Conversion:**  
  Provide temperature readings in both Celsius and Fahrenheit, and relative humidity as a percentage.
- **Validation & Error Handling:**  
  Validate sensor data for integrity (e.g., checksum verification) internally. If a checksum mismatch occurs, emit an error event to subscribers but do not stop the service. Consumers are not exposed to checksum logic directly.
- **API Exposure:**  
  Expose a clear, typed API for other services/controllers to request the latest sensor readings or subscribe to updates.
- **Extensibility:**  
  Design the service to allow for future support of additional sensor types or calibration logic.

## Development Plan

1. **Define Data Types**

   - Create strong TypeScript types for raw sensor data, decoded readings, and error states.

2. **Signal Decoding Logic**

   - Implement logic to decode the AM2302 signal timing into raw humidity and temperature values.
   - Verify data integrity using the sensor’s checksum internally. On mismatch, emit an error event but continue service operation.

3. **Unit Conversion**

   - Convert raw readings to Celsius, Fahrenheit, and percentage RH.

4. **Error Handling**

   - Handle invalid signals, checksum mismatches, and out-of-range values.
   - Provide meaningful error messages and types.
   - All errors, including checksum errors, are surfaced to consumers only as error events and do not stop the service.

5. **Service API**

   - Expose functions to:
     - Get the latest reading (with timestamp).
     - Subscribe to new readings (observable/event-driven pattern). Subscribers receive both valid readings and error events.
     - Get the last error state.

6. **Integration**

   - Use the GPIO Pin Service for low-level pin access and event subscription.
   - Ensure the service is decoupled from hardware details.

7. **Testing**
   - Unit test decoding, conversion, and error handling logic with both valid and invalid data.
   - Mock GPIO Pin Service for isolated tests.

## TypeScript API

```typescript
export type TempSensorReading = {
  temperatureC: number;
  temperatureF: number;
  relativeHumidityPercentage: number;
  timestamp: number;
};

export type TempSensorError =
  | { type: "checksum"; message: string }
  | { type: "signal"; message: string }
  | { type: "range"; message: string };

export type Unsubscribe = () => void;

export type TempSensorService = {
  /**
   * Returns the latest valid reading or the last error (including checksum errors).
   * Does not throw on checksum errors; these are surfaced as error events only.
   */
  getLatestReading(): Promise<TempSensorReading | TempSensorError>;

  /**
   * Subscribe to new readings and error events (including checksum errors).
   * The service continues running after checksum errors.
   * Returns an unsubscribe function.
   */
  subscribe(
    callback: (event: TempSensorReading | TempSensorError) => void,
  ): Unsubscribe;
};
```
