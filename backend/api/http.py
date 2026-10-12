"""Single outbound-HTTP helper so every provider gets the same timeout and error mapping."""
import time

import httpx
from django.conf import settings
from rest_framework.exceptions import APIException


class ProviderError(APIException):
    """An upstream provider failed. `upstream` is the provider's HTTP status when known."""

    status_code = 502
    default_detail = 'Upstream provider error.'

    def __init__(self, detail, status_code=None, upstream=None):
        super().__init__(detail)
        if status_code:
            self.status_code = status_code
        self.upstream = upstream


def request_json(method, url, *, provider, **kwargs):
    kwargs.setdefault('timeout', settings.EXTERNAL_API_TIMEOUT_SECONDS)
    for attempt in range(2):  # public providers return sporadic 5xx; one quick retry hides most of them
        try:
            resp = httpx.request(method, url, **kwargs)
        except httpx.TimeoutException:
            raise ProviderError(f'{provider} timed out.', 504)
        except httpx.HTTPError:
            raise ProviderError(f'{provider} is unreachable.', 502)
        if resp.status_code not in (429, 500, 502, 503, 504) or attempt:
            break
        time.sleep(1.5 if resp.status_code == 429 else 0.8)
    if resp.status_code == 429:
        raise ProviderError(f'{provider} rate limit reached; retry later.', 503, upstream=429)
    if resp.status_code in (401, 403):
        raise ProviderError(
            f'{provider} refused the request (HTTP {resp.status_code}); check its API key or User-Agent setting.',
            503, upstream=resp.status_code,
        )
    if resp.status_code in (400, 404, 422):
        # The provider rejected this specific request (e.g. a location with no road, a route
        # beyond its distance limit). Its message is safe to show and tells the user what to change.
        raise ProviderError(
            f'{provider}: {_provider_message(resp) or "the request was rejected"}',
            422, upstream=resp.status_code,
        )
    if resp.status_code >= 400:
        raise ProviderError(f'{provider} returned HTTP {resp.status_code}.', 502, upstream=resp.status_code)
    try:
        return resp.json()
    except ValueError:
        raise ProviderError(f'{provider} returned invalid JSON.', 502)


def _provider_message(resp):
    """Best-effort human message from a provider error body (ORS, Open-Meteo, generic)."""
    try:
        body = resp.json()
    except ValueError:
        return ''
    if isinstance(body, dict):
        err = body.get('error', body.get('reason', body.get('message')))
        if isinstance(err, dict):
            err = err.get('message')
        if isinstance(err, str):
            return err[:240]
    return ''
