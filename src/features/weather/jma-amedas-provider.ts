/** Public module for the JMA adapter. The implementation lives in the
 * dependency-free core so Supabase Edge Functions can use the same parser. */
export {
  JmaAmedasProvider,
  JMA_AMEDAS_HOURS,
  JMA_AMEDAS_POINT_URL_BASE,
  JMA_AMEDAS_PROVIDER_REVISION,
  JMA_AMEDAS_STATION_LIST_URL,
  JMA_AMEDAS_TIME_ZONE,
  aggregateJmaDaily,
  parseJmaPointPayload,
  parseJmaStationList,
  parseJmaTimestamp,
} from "./weather-core";
export type {
  AggregatedJmaDailyValue,
  DailyWeatherValue,
  GeoPoint,
  JmaAmedasRecord,
  JmaAmedasSample,
  JmaAmedasProviderOptions,
  WeatherFetcher,
  WeatherLocation,
  WeatherProvider,
  WeatherQualityCode,
} from "./weather-core";
