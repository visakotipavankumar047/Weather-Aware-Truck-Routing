from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Checkpoint, Route, Trip


@extend_schema_field({'oneOf': [
    {'type': 'string', 'example': 'Denver, CO'},
    {'type': 'object', 'required': ['lat', 'lon'],
     'properties': {'label': {'type': 'string'}, 'lat': {'type': 'number'}, 'lon': {'type': 'number'}}},
]})
class PlaceField(serializers.Field):
    """A free-text query ("Denver, CO") or a resolved place {label, lat, lon}
    (e.g. a result picked from /api/geocoding/search/, which skips re-geocoding)."""

    default_error_messages = {'invalid': 'Provide a place name or an object with label, lat and lon.'}

    def to_internal_value(self, data):
        if isinstance(data, str) and data.strip():
            return {'query': data.strip()}
        if isinstance(data, dict):
            try:
                lat, lon = float(data['lat']), float(data['lon'])
            except (KeyError, TypeError, ValueError):
                self.fail('invalid')
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return {'label': str(data.get('label') or f'{lat:.4f}, {lon:.4f}'), 'lat': lat, 'lon': lon}
        self.fail('invalid')

    def to_representation(self, value):
        return value


class AwareDateTimeField(serializers.DateTimeField):
    """Reject naive timestamps instead of silently assuming UTC."""

    def enforce_timezone(self, value):
        if value.tzinfo is None:
            raise serializers.ValidationError('Timestamp must include a timezone offset (e.g. 2026-10-20T08:00:00Z).')
        return value


class TripInputSerializer(serializers.Serializer):
    origin = PlaceField()
    destination = PlaceField()
    departure_at = AwareDateTimeField()
    load_weight_lb = serializers.FloatField()
    checkpoint_interval_miles = serializers.ChoiceField(choices=[10, 25, 50])

    def validate_load_weight_lb(self, value):
        if value <= 0:
            raise serializers.ValidationError('Must be greater than zero.')
        return value


class CheckpointSerializer(serializers.ModelSerializer):
    class Meta:
        model = Checkpoint
        fields = ['sequence', 'distance_miles', 'lat', 'lon', 'eta', 'weather', 'risk', 'reasons']


class RouteSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Route
        fields = ['id', 'label', 'rank', 'eligible', 'distance_miles', 'duration_minutes', 'risk_summary']


class RouteGeometrySerializer(RouteSummarySerializer):
    class Meta(RouteSummarySerializer.Meta):
        fields = RouteSummarySerializer.Meta.fields + ['geometry']


class RouteDetailSerializer(RouteGeometrySerializer):
    checkpoints = CheckpointSerializer(many=True)

    class Meta(RouteGeometrySerializer.Meta):
        fields = RouteGeometrySerializer.Meta.fields + ['checkpoints']


class TripSerializer(serializers.ModelSerializer):
    """Trip + recommendation + per-route summaries (no geometry/checkpoints)."""
    trip_id = serializers.UUIDField(source='id')
    recommended_route_id = serializers.IntegerField(allow_null=True)
    routes = RouteSummarySerializer(many=True)

    class Meta:
        model = Trip
        fields = [
            'trip_id', 'origin_label', 'origin_lat', 'origin_lon', 'destination_label',
            'destination_lat', 'destination_lon', 'departure_at', 'load_weight_lb',
            'checkpoint_interval_miles', 'recommended_route_id', 'routes', 'warnings', 'created_at',
        ]


class TripDetailSerializer(TripSerializer):
    """Full analysis: routes include geometry and checkpoints."""
    routes = RouteDetailSerializer(many=True)
