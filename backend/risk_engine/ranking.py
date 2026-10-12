"""Pure route aggregation and ranking.

Miles: each segment between checkpoint i and i+1 takes the level of the
PRECEDING checkpoint i (the final checkpoint covers 0 miles but still counts for
`has_no_travel`). Same method for every route.
"""
from .classifiers import LEVELS, SCORE, UNKNOWN


def summarize(checkpoints):
    """checkpoints: [(distance_miles, level)] ordered by distance."""
    miles = dict.fromkeys((*LEVELS, UNKNOWN), 0.0)
    for (d, level), (next_d, _) in zip(checkpoints, checkpoints[1:]):
        miles[level] += next_d - d
    known = sum(miles[level] for level in LEVELS)
    avg = sum(SCORE[level] * miles[level] for level in LEVELS) / known if known else None
    return {
        'severe_miles': round(miles['SEVERE'], 2),
        'high_miles': round(miles['HIGH'], 2),
        'no_travel_miles': round(miles['NO_TRAVEL'], 2),
        'unknown_miles': round(miles[UNKNOWN], 2),
        # 0=LOW .. 4=NO_TRAVEL, mileage-weighted over miles with known weather only
        'average_risk': None if avg is None else round(avg, 3),
        'has_no_travel': any(level == 'NO_TRAVEL' for _, level in checkpoints),
    }


def rank_key(summary, duration_minutes):
    """Lexicographic: NO_TRAVEL routes last, then severe miles, high miles (unknown miles
    are pessimistically counted as high so missing data is never rewarded), average
    risk, travel time."""
    return (
        summary['has_no_travel'],
        summary['no_travel_miles'],
        summary['severe_miles'],
        summary['high_miles'] + summary['unknown_miles'],
        summary['average_risk'] or 0,
        duration_minutes,
    )
