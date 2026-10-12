from django.urls import path

from . import views

urlpatterns = [
    path('', views.TripCreateView.as_view()),
    path('<uuid:trip_id>/', views.TripDetailView.as_view()),
    path('<uuid:trip_id>/routes/', views.TripRoutesView.as_view()),
    path('<uuid:trip_id>/checkpoints/', views.TripCheckpointsView.as_view()),
    path('<uuid:trip_id>/forecast/', views.TripForecastView.as_view()),
    path('<uuid:trip_id>/traffic/', views.TripTrafficView.as_view()),
    path('<uuid:trip_id>/reanalyze/', views.TripReanalyzeView.as_view()),
]
