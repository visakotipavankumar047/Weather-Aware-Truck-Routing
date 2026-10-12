"""Pure risk classification (no I/O). Thresholds come from the assessment.

Boundary convention: cutoffs are lower-inclusive, so a value exactly on a shared
boundary (rain 0.25/0.50, snow 1.0/2.0) takes the HIGHER level. NO_TRAVEL for
rain/snow is strictly greater than the top value as written (>1.00, >3.0);
wind NO_TRAVEL is >=55 mph as written.
"""
LEVELS = ('LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL')
UNKNOWN = 'UNKNOWN'
SCORE = {name: i for i, name in enumerate(LEVELS)}

# (cutoffs for MODERATE/HIGH/SEVERE/NO_TRAVEL, is the NO_TRAVEL cutoff exclusive?)
THRESHOLDS = {
    'wind': ((25, 35, 45, 55), False),         # mph
    'rain': ((0.10, 0.25, 0.50, 1.00), True),  # in/hr
    'snow': ((0.5, 1.0, 2.0, 3.0), True),      # in/hr
}
UNITS = {'wind': 'mph', 'rain': 'in/hr', 'snow': 'in/hr'}


def _index(value, cuts, top_exclusive):
    if (value > cuts[3]) if top_exclusive else (value >= cuts[3]):
        return 4
    return sum(value >= c for c in cuts[:3])


def classify(wind_mph, rain_in_hr, snow_in_hr, load_lb):
    """Return (level, reasons). Any missing input -> UNKNOWN (never LOW)."""
    if None in (wind_mph, rain_in_hr, snow_in_hr):
        return UNKNOWN, ['weather data unavailable']
    values = {'wind': wind_mph, 'rain': rain_in_hr, 'snow': snow_in_hr}
    idx = {k: _index(v, *THRESHOLDS[k]) for k, v in values.items()}
    reasons = [f'{k} {values[k]:g} {UNITS[k]}: {LEVELS[i]}' for k, i in idx.items() if i]

    # Load-related wind overrides; they can only raise the wind level.
    if wind_mph >= 45 and load_lb > 30000:
        if idx['wind'] < 4:
            reasons.append(f'wind {wind_mph:g} mph with load {load_lb:g} lb > 30000 lb: NO_TRAVEL')
        idx['wind'] = 4
    elif 35 <= wind_mph < 45 and load_lb > 40000:
        reasons.append(f'wind {wind_mph:g} mph with load {load_lb:g} lb > 40000 lb: SEVERE')
        idx['wind'] = max(idx['wind'], 3)
    return LEVELS[max(idx.values())], reasons or ['all hazards below thresholds']
