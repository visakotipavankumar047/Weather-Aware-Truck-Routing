import uuid

from django.db import models


class Place(models.Model):
    """A named coordinate; trip origins and destinations point here instead of repeating label/lat/lon."""
    label = models.CharField(max_length=500)
    lat = models.FloatField()
    lon = models.FloatField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['label', 'lat', 'lon'], name='unique_place')]

    def __str__(self):
        return self.label


class RiskLevel(models.Model):
    """Lookup of risk codes (LOW..NO_TRAVEL, UNKNOWN); checkpoints reference it by code."""
    code = models.CharField(max_length=10, primary_key=True)

    def __str__(self):
        return self.code


class Trip(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    origin = models.ForeignKey(Place, on_delete=models.PROTECT, related_name='+')
    destination = models.ForeignKey(Place, on_delete=models.PROTECT, related_name='+')
    departure_at = models.DateTimeField()
    load_weight_lb = models.FloatField()
    checkpoint_interval_miles = models.PositiveSmallIntegerField()
    recommended_route = models.ForeignKey(
        'Route', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    warnings = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.origin} -> {self.destination}'


class Route(models.Model):
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='routes')
    label = models.CharField(max_length=40, blank=True, default='')  # how this alternative was found
    rank = models.PositiveSmallIntegerField()  # 1 = best by the lexicographic ranking
    eligible = models.BooleanField()  # False if any checkpoint is NO_TRAVEL
    distance_miles = models.FloatField()
    duration_minutes = models.FloatField()
    geometry = models.JSONField()  # [[lat, lon], ...]
    risk_summary = models.JSONField()

    class Meta:
        ordering = ['rank']


class Checkpoint(models.Model):
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name='checkpoints')
    sequence = models.PositiveIntegerField()
    distance_miles = models.FloatField()
    lat = models.FloatField()
    lon = models.FloatField()
    eta = models.DateTimeField()  # at forecast offset 0
    weather = models.JSONField(null=True)  # None = no forecast available
    risk = models.ForeignKey(RiskLevel, on_delete=models.PROTECT, related_name='+')
    reasons = models.JSONField(default=list)

    class Meta:
        ordering = ['sequence']
