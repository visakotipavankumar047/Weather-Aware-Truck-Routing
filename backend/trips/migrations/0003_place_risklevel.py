import django.db.models.deletion
from django.db import migrations, models

RISK_CODES = ['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL', 'UNKNOWN']


def forwards(apps, schema_editor):
    Place, Trip, RiskLevel = (apps.get_model('trips', m) for m in ('Place', 'Trip', 'RiskLevel'))
    RiskLevel.objects.bulk_create([RiskLevel(code=c) for c in RISK_CODES])
    for t in Trip.objects.all():
        t.origin = Place.objects.get_or_create(label=t.origin_label, lat=t.origin_lat, lon=t.origin_lon)[0]
        t.destination = Place.objects.get_or_create(
            label=t.destination_label, lat=t.destination_lat, lon=t.destination_lon)[0]
        t.save(update_fields=['origin', 'destination'])


class Migration(migrations.Migration):

    dependencies = [('trips', '0002_route_label')]

    operations = [
        migrations.CreateModel(
            name='Place',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=500)),
                ('lat', models.FloatField()),
                ('lon', models.FloatField()),
            ],
        ),
        migrations.AddConstraint(
            model_name='place',
            constraint=models.UniqueConstraint(fields=('label', 'lat', 'lon'), name='unique_place'),
        ),
        migrations.CreateModel(
            name='RiskLevel',
            fields=[('code', models.CharField(max_length=10, primary_key=True, serialize=False))],
        ),
        migrations.AddField(
            model_name='trip', name='origin',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='trips.place'),
        ),
        migrations.AddField(
            model_name='trip', name='destination',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='trips.place'),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='trip', name='origin',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='trips.place'),
        ),
        migrations.AlterField(
            model_name='trip', name='destination',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='trips.place'),
        ),
        *[migrations.RemoveField(model_name='trip', name=f) for f in (
            'origin_label', 'origin_lat', 'origin_lon', 'destination_label', 'destination_lat', 'destination_lon')],
        migrations.AlterField(
            model_name='checkpoint', name='risk',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='trips.risklevel'),
        ),
    ]
