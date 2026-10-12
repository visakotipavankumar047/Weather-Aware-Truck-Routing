from django.contrib import admin

from .models import Checkpoint, Route, Trip

admin.site.register([Trip, Route, Checkpoint])
