from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from routing.views import GeocodeView
from trips import stateless

from . import traffic, views

urlpatterns = [
    path('health/', views.health),
    path('geocoding/search/', GeocodeView.as_view()),
    path('trips/', include('trips.urls')),
    path('forecast/', stateless.ForecastView.as_view()),
    path('forecast/sweep/', stateless.ForecastSweepView.as_view()),
    path('traffic/routes/', stateless.TrafficRoutesView.as_view()),
    path('traffic/status/', traffic.TrafficStatusView.as_view()),
    path('traffic/tiles/<int:z>/<int:x>/<int:y>.png', traffic.TrafficTileView.as_view()),
    path('schema/', SpectacularAPIView.as_view(), name='schema'),
    path('docs/', SpectacularSwaggerView.as_view(url_name='schema')),
]
