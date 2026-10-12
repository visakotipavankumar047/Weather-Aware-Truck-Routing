from django.contrib import admin

from .models import Checkpoint, Place, RiskLevel, Route, Trip

admin.site.register([Trip, Route, Checkpoint, Place, RiskLevel])
