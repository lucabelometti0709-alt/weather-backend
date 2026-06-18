const GEOCODING_API_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_API_URL = "https://api.open-meteo.com/v1/forecast";

export const searchLocations = async (query) => {
  const params = new URLSearchParams({
    name: query,
    count: 5,
    language: "it",
    format: "json",
  });

  const response = await fetch(`${GEOCODING_API_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Errore dal provider Open-Meteo (Geocoding): ${response.status}`);
  }

  const data = await response.json();

  if (!data.results) {
    return [];
  }

  return data.results.map((loc) => ({
    id: loc.id,
    name: loc.name,
    latitude: loc.latitude,
    longitude: loc.longitude,
    country: loc.country,
    admin1: loc.admin1,
    timezone: loc.timezone,
  }));
};

export const getForecast = async (lat, lon) => {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
    hourly: "temperature_2m,weather_code,precipitation_probability,wind_speed_10m,apparent_temperature",
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,surface_pressure",
    timezone: "auto",
    forecast_days: 6,
  });

  const response = await fetch(`${FORECAST_API_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Errore dal provider Open-Meteo (Forecast): ${response.status}`);
  }

  const data = await response.json();
  return data;
};
