"""Stateless variants of the forecast and traffic endpoints.

On serverless hosting the database may be a throw-away file, so a request can land on an
instance that never saw the trip. These endpoints take the routes in the request body (the
client received them from POST /api/trips/) and need no stored state."""
import hashlib
import json

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services, traffic
from .serializers import AwareDateTimeField
from .views import forecast_body


class CheckpointIn(serializers.Serializer):
    sequence = serializers.IntegerField(min_value=0)
    distance_miles = serializers.FloatField(min_value=0)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    eta = AwareDateTimeField()


class RouteIn(serializers.Serializer):
    id = serializers.IntegerField()
    distance_miles = serializers.FloatField(min_value=0)
    duration_minutes = serializers.FloatField(min_value=0)
    checkpoints = serializers.ListField(child=CheckpointIn(), min_length=1, max_length=1500)


class ForecastIn(serializers.Serializer):
    load_weight_lb = serializers.FloatField(min_value=1)
    offset_hours = serializers.IntegerField(min_value=0, max_value=48, default=0)
    routes = serializers.ListField(child=RouteIn(), min_length=1, max_length=5)


class SweepIn(serializers.Serializer):
    load_weight_lb = serializers.FloatField(min_value=1)
    offsets = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=48), min_length=1, max_length=49,
        default=list(range(0, 49, 3)),
    )
    routes = serializers.ListField(child=RouteIn(), min_length=1, max_length=5)


def _routes(data):
    return [
        {
            'id': r['id'], 'distance_miles': r['distance_miles'], 'duration_minutes': r['duration_minutes'],
            'checkpoints': [dict(c) for c in r['checkpoints']],
        }
        for r in data['routes']
    ]


class ForecastView(APIView):
    @extend_schema(request=ForecastIn, responses={200: {'type': 'object'}})
    def post(self, request):
        s = ForecastIn(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        result = services.rescore(_routes(d), d['load_weight_lb'], d['offset_hours'])
        return Response(forecast_body(result, d['offset_hours']))


class ForecastSweepView(APIView):
    """Route summaries for many departure offsets in ONE request, so the forecast is fetched
    from the weather provider once instead of once per offset."""

    @extend_schema(request=SweepIn, responses={200: {'type': 'object'}})
    def post(self, request):
        s = SweepIn(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        routes = _routes(d)
        out = []
        for offset in d['offsets']:
            r = services.rescore(routes, d['load_weight_lb'], offset)
            out.append({
                'offset_hours': offset,
                'recommended_route_id': r['recommended_route_id'],
                'routes': [
                    {k: x[k] for k in ('id', 'rank', 'eligible', 'distance_miles', 'duration_minutes', 'risk_summary')}
                    for x in r['routes']
                ],
            })
        return Response({'offsets': out})


class PointIn(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class TrafficRouteIn(serializers.Serializer):
    id = serializers.IntegerField()
    geometry = serializers.ListField(
        child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
        min_length=2, max_length=400,
    )


class TrafficIn(serializers.Serializer):
    origin = PointIn()
    destination = PointIn()
    departure_at = AwareDateTimeField()
    offset_hours = serializers.IntegerField(min_value=0, max_value=48, default=0)
    routes = serializers.ListField(child=TrafficRouteIn(), min_length=1, max_length=5)


class TrafficRoutesView(APIView):
    @extend_schema(request=TrafficIn, responses={200: {'type': 'object'}})
    def post(self, request):
        s = TrafficIn(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        routes = [(r['id'], [tuple(p) for p in r['geometry']]) for r in d['routes']]
        digest = hashlib.sha1(json.dumps(
            [d['origin'], d['destination'], d['departure_at'].isoformat(), d['offset_hours'],
             [(rid, g[::max(1, len(g) // 20)]) for rid, g in routes]], sort_keys=True, default=str,
        ).encode()).hexdigest()
        body = traffic.traffic_for_routes(
            (d['origin']['lat'], d['origin']['lon']), (d['destination']['lat'], d['destination']['lon']),
            d['departure_at'], d['offset_hours'], routes, f'traffic:s:{digest}',
        )
        return Response(body)


