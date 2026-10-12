import uuid

from django.db import models


class Trip(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    origin_label = models.CharField(max_length=500)
    origin_lat = models.FloatField()
    origin_lon = models.FloatField()
    destination_label = models.CharField(max_length=500)
    destination_lat = models.FloatField()
    destination_lon = models.FloatField()
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
        return f'{self.origin_label} -> {self.destination_label}'


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
    risk = models.CharField(max_length=10)  # LOW..NO_TRAVEL or UNKNOWN
    reasons = models.JSONField(default=list)

    class Meta:
        ordering = ['sequence']
