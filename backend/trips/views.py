from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from routing.providers import resolve_place

from . import services, traffic
from .models import Trip
from .serializers import (
    CheckpointSerializer,
    RouteGeometrySerializer,
    TripDetailSerializer,
    TripInputSerializer,
    TripSerializer,
)


def _trip(trip_id):
    return get_object_or_404(Trip.objects.prefetch_related('routes__checkpoints'), pk=trip_id)


def _run(trip):
    result = services.analyze(
        {'lat': trip.origin_lat, 'lon': trip.origin_lon},
        {'lat': trip.destination_lat, 'lon': trip.destination_lon},
        trip.departure_at, trip.load_weight_lb, trip.checkpoint_interval_miles,
    )
    services.save(trip, result)
    return Response(TripDetailSerializer(_trip(trip.pk)).data)


class TripCreateView(APIView):
    @extend_schema(request=TripInputSerializer, responses={201: TripDetailSerializer})
    def post(self, request):
        s = TripInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        o, dest = resolve_place(d['origin'], 'origin'), resolve_place(d['destination'], 'destination')
        trip = Trip.objects.create(
            origin_label=o['label'], origin_lat=o['lat'], origin_lon=o['lon'],
            destination_label=dest['label'], destination_lat=dest['lat'], destination_lon=dest['lon'],
            departure_at=d['departure_at'], load_weight_lb=d['load_weight_lb'],
            checkpoint_interval_miles=d['checkpoint_interval_miles'],
        )
        try:
            response = _run(trip)
        except Exception:
            trip.delete()  # no half-analysed trips left behind when a provider fails
            raise
        response.status_code = 201
        return response


class TripDetailView(APIView):
    @extend_schema(responses=TripSerializer)
    def get(self, request, trip_id):
        return Response(TripSerializer(_trip(trip_id)).data)


class TripRoutesView(APIView):
    @extend_schema(responses=RouteGeometrySerializer(many=True))
    def get(self, request, trip_id):
        return Response(RouteGeometrySerializer(_trip(trip_id).routes.all(), many=True).data)


class TripCheckpointsView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter('route_id', int, required=False)],
        responses={200: {'type': 'array', 'items': {'type': 'object', 'properties': {
            'route_id': {'type': 'integer'},
            'checkpoints': {'type': 'array', 'items': {'type': 'object'}}}}}},
    )
    def get(self, request, trip_id):
        routes = _trip(trip_id).routes.all()
        route_id = request.query_params.get('route_id')
        if route_id is not None:
            if not route_id.isdigit():
                raise ValidationError({'route_id': 'Must be an integer.'})
            routes = [r for r in routes if r.id == int(route_id)]
        return Response([
            {'route_id': r.id, 'checkpoints': CheckpointSerializer(r.checkpoints.all(), many=True).data}
            for r in routes
        ])


def forecast_body(result, offset, trip_id=None):
    body = {
        'offset_hours': offset,
        'recommended_route_id': result['recommended_route_id'],
        'routes': [
            {
                'id': r['id'], 'rank': r['rank'], 'eligible': r['eligible'],
                'distance_miles': r['distance_miles'], 'duration_minutes': r['duration_minutes'],
                'risk_summary': r['risk_summary'],
                'checkpoints': [
                    {k: c[k] for k in ('sequence', 'distance_miles', 'lat', 'lon', 'eta', 'weather', 'risk', 'reasons')}
                    for c in r['checkpoints']
                ],
            }
            for r in result['routes']
        ],
    }
    if trip_id is not None:
        body = {'trip_id': trip_id, **body}
    return body


class TripForecastView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter('offset_hours', int, description='0-48, hours added to every ETA.')],
        responses={200: {'type': 'object'}},
    )
    def get(self, request, trip_id):
        raw = request.query_params.get('offset_hours', '0')
        if not raw.isdigit() or not 0 <= int(raw) <= 48:
            raise ValidationError({'offset_hours': 'Must be an integer from 0 to 48.'})
        offset = int(raw)
        trip = _trip(trip_id)
        result = services.forecast(trip, offset)
        return Response(forecast_body(result, offset, trip.id))


class TripReanalyzeView(APIView):
    @extend_schema(request=None, responses=TripDetailSerializer)
    def post(self, request, trip_id):
        return _run(_trip(trip_id))


class TripTrafficView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter('offset_hours', int, description='0-48, hours added to departure.')],
        responses={200: {'type': 'object'}},
    )
    def get(self, request, trip_id):
        raw = request.query_params.get('offset_hours', '0')
        if not raw.isdigit() or not 0 <= int(raw) <= 48:
            raise ValidationError({'offset_hours': 'Must be an integer from 0 to 48.'})
        trip = _trip(trip_id)
        return Response({'trip_id': trip.id, **traffic.trip_traffic(trip, int(raw))})
