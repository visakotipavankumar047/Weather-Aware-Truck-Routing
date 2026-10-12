"""Open-Meteo adapter. One request covers many coordinates."""
from datetime import UTC, datetime

from django.conf import settings

from api.http import ProviderError, request_json

HOURLY = 'wind_speed_10m,rain,showers,snowfall'


def fetch_hourly(points):
    """points: [(lat, lon)] -> list (same order) of {hour_utc: weather}.

    Units are requested as mph and inches. Open-Meteo hourly precipitation is an
    hourly *amount*, used here as in/hr (an hourly total over 1 h equals the mean
    rate). Rain = rain + showers; snow = snowfall (inches of snow, not water
    equivalent). Hours with any missing value are omitted so they read as UNKNOWN."""
    data = request_json(
        'GET', settings.OPEN_METEO_BASE_URL, provider='Open-Meteo',
        params={
            'latitude': ','.join(f'{lat:.4f}' for lat, _ in points),
            'longitude': ','.join(f'{lon:.4f}' for _, lon in points),
            'hourly': HOURLY,
            'wind_speed_unit': 'mph',
            'precipitation_unit': 'inch',
            'timezone': 'UTC',
            'past_days': 1,
            'forecast_days': 16,
        },
    )
    results = [data] if isinstance(data, dict) else data
    if not isinstance(results, list) or len(results) != len(points):
        raise ProviderError('Open-Meteo returned an unexpected response.')
    return [_parse(r) for r in results]


def _parse(result):
    try:
        h = result['hourly']
        snow_scale = 1 / 2.54 if result.get('hourly_units', {}).get('snowfall') == 'cm' else 1
        series = {}
        for t, wind, rain, showers, snow in zip(
            h['time'], h['wind_speed_10m'], h['rain'], h['showers'], h['snowfall']
        ):
            if None in (wind, rain, showers, snow):
                continue
            hour = datetime.fromisoformat(t).replace(tzinfo=UTC)
            series[hour] = {
                'forecast_time': hour.isoformat(),
                'wind_mph': wind,
                'rain_in_hr': rain + showers,
                'snow_in_hr': snow * snow_scale,
            }
        return series
    except (TypeError, KeyError, ValueError):
        raise ProviderError('Open-Meteo returned an unexpected response.')
