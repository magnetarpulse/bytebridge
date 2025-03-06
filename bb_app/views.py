import os
import requests
import json
import uuid
from django.http import JsonResponse
from django.http import HttpResponse
from django.shortcuts import render
from django.shortcuts import redirect
from django.contrib import messages
from django.contrib.messages import get_messages
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from .models import *
from .serializers import *
from bs4 import BeautifulSoup
# Create your views here.


# api to connect bb with nc
NC_connect_url = 'http://127.0.0.1:8000/api/nc_connect'


def BB_CONNECT(request):

    username = os.environ.get('username')
    password = os.environ.get('password')

    if not username or not password:
        return JsonResponse({'error': 'Missing credentials'}, status=400)

    print(f"Requesting authentication from BB with {username}:{password}")

    payload = {'username': username, 'password': password}

    try:
        response = requests.post(NC_connect_url, json=payload, timeout=5)

        if response.status_code == 200:
            print("Connection with NC successful")
            return HttpResponse(response.content)
            
        else:
            return JsonResponse({'error': 'Failed to connect'}, status=response.status_code)

    except requests.exceptions.RequestException as e:
        return JsonResponse({'error': 'Connection error', 'details': str(e)}, status=500)


class CreateDatastoreAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data['owner_id']
            instance_id = data['instance_id']
            datastore_id = data['datastore_id']
            datastore_name = data['datastore_name']
            static_path = data['static_path']

            bb_datastore, created_at = Datastores.objects.get_or_create(datastore_id=datastore_id,
                                    defaults={'owner_id': owner_id,
                                            'instance_id': instance_id,
                                            'datastore_name':datastore_name,
                                            'accessed_at': timezone.now()})
            if bb_datastore:
                print(f"Datastore with ID: {bb_datastore.datastore_id} accessed at {bb_datastore.accessed_at}")

                if not static_path:
                    return JsonResponse({'error': 'Missing static path'}, status=400)

                else:
                    os.makedirs(f"{static_path}/{str(datastore_id)}", exist_ok=True)
                    print('Directory created successfully')

            return JsonResponse({'message': 'Endpoint received by BB'}, status=200)
        
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)
    

class SendUserDatastoresAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')

            print(f"Owner ID sent by NC: {owner_id}")

            if not owner_id:
                return JsonResponse({'error': 'Missing owner_id'}, status=400)

            # Retrieve datastores for the owner
            all_datastores = list(Datastores.objects.filter(owner_id=owner_id).values_list('datastore_name', flat=True))
            for datastore in all_datastores:
                datastore_obj = Datastores.objects.get(datastore_name=datastore, owner_id=owner_id)
                datastore_obj.accessed_at = timezone.now()
                datastore_obj.save()

            print(f"All datastores owned by {owner_id}: {all_datastores}")

            return JsonResponse({'message': 'Owner ID received by BB', 'all_datastores': all_datastores}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)



class Change_DS_Settings(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_ds = data.get('selected_ds')
            private_permissions = data.get('private_permissions')
            datastore_name = data.get('datastore_name')

            if not selected_ds or not private_permissions:
                return JsonResponse({'error': 'Missing required parameters'}, status=400)

            selected_datastore = Datastores.objects.get(datastore_name=selected_ds, owner_id=owner_id)
            selected_datastore.accessed_at = timezone.now()
            selected_datastore.save()

            new_value = private_permissions == 'private'
            if new_value != selected_datastore.private_permissions:
                selected_datastore.private_permissions = new_value
                selected_datastore.save()
                messages.success(request, 'Datastore privacy updated successfully\n')

                if datastore_name:
                    if datastore_name != selected_datastore.datastore_name:  
                        selected_datastore.datastore_name = datastore_name
                        selected_datastore.save()
                        messages.success(request, 'Datastore name updated successfully')


                    else:
                        messages.error(request, 'Datastore name is already set to the selected value')
                else:
                    messages.error(request, 'Datastore privacy is already set to the selected value')
                    
                return JsonResponse({'message': 'Datastore settings updated successfully'}, status=200)
            
                                    
                print(f"Datastore privacy updated to {private_permissions} for user {owner_id}") 
                print(f"Datastore name updated to {datastore_name} for user {owner_id}")
            
            else:
                return JsonResponse({'error': 'Datastore settings already set to the selected value'}, status=200)
                
        except Exception as e:
            return JsonResponse({'error': f'Error: {str(e)}'}, status=400)


class SendAllDatastoresAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')

            self.datastores_upload = []
            # user datastores
            user_specific_ds = Datastores.objects.filter(owner_id=owner_id).values_list('datastore_name', flat=True)
            self.datastores_upload.extend(user_specific_ds)

            # Get all public datastores except the user's own
            public_ds_all = Datastores.objects.filter(private_permissions=False).exclude(owner_id=owner_id).values_list('datastore_name', flat=True)
            self.datastores_upload.extend(public_ds_all)

            for datastore in self.datastores_upload:
                datastore_obj = Datastores.objects.get(datastore_name=datastore)
                datastore_obj.accessed_at = timezone.now()
                datastore_obj.save()

            print(f"Public datastores Available for {owner_id}: {self.datastores_upload}")
            
            return JsonResponse({'message': 'Owner ID received by BB', 'datastores_upload': self.datastores_upload}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)


def get_buckets_for_user(owner_id, selected_datastore):
    """ Retrieve all buckets for a user in a selected datastore. """
    buckets_upload = list(
        Buckets.objects.filter(datastore_id=selected_datastore, owner_id=owner_id)
        .values_list('bucket_name', flat=True)
    )

    public_buckets = list(
        Buckets.objects.filter(datastore_id=selected_datastore, private_permissions=False)
        .exclude(owner_id=owner_id)
        .values_list('bucket_name', flat=True)
    )

    if public_buckets:
        buckets_upload.extend(public_buckets)
        Buckets.objects.filter(bucket_name__in=public_buckets).update(accessed_at=timezone.now())

    return buckets_upload

class SendBuckets(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_ds = data.get('selected_ds')

            print(f"Selected Datastore: {selected_ds}")

            selected_datastore = Datastores.objects.get(datastore_name=selected_ds)
            selected_datastore.accessed_at = timezone.now()
            selected_datastore.save()

            # Retrieve buckets using the reusable function
            buckets_upload = get_buckets_for_user(owner_id, selected_datastore)

            if buckets_upload:
                return JsonResponse({'message': 'Buckets sent from bb', 'buckets_upload': buckets_upload}, status=200)
            else:
                return JsonResponse({'message': 'No bucket found, create a bucket'}, status=201)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)



class CreateBuckets(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_ds = data.get('selected_ds')
            bucket_name = data.get('bucket_name')
            static_path = data.get('static_path')

            print(f"Selected Datastore: {selected_ds}")
            print(f"Bucket Name: {bucket_name}")

            selected_datastore = Datastores.objects.get(datastore_name=selected_ds)
            selected_datastore.accessed_at = timezone.now()
            selected_datastore.save()

            # Create the bucket
            bucket_obj = Buckets.objects.create(
                datastore_id=selected_datastore,
                owner_id=owner_id,
                bucket_name=bucket_name,
                bucket_id=uuid.uuid4(),
                accessed_at=timezone.now(),
            )

            if bucket_obj:
                print(f"Bucket with ID: {bucket_obj.bucket_id} accessed at {bucket_obj.accessed_at}")

                # Create directory
                os.makedirs(f"{static_path}/{selected_datastore.datastore_id}/{bucket_obj.bucket_id}", exist_ok=True)
                print('Directory created successfully')

                # Retrieve updated list of buckets
                buckets_upload = get_buckets_for_user(owner_id, selected_datastore)

                return JsonResponse({'message': 'Bucket created successfully', 'buckets_upload': buckets_upload}, status=200)

            return JsonResponse({'error': 'Failed to create bucket'}, status=400)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)


class CreateObjects(APIView):
    def post(self, request):
        try:
            owner_id = request.POST.get('owner_id')
            static_path = request.POST.get('static_path')
            selected_ds = request.POST.get('selected_ds')
            selected_bucket = request.POST.get('selected_bucket')
            file = request.FILES.get('file')  # Get file from request.FILES
            file_type = request.POST.get('file_type')

            if file:
                file_name = file.name
                file_size = file.size
                file_id=uuid.uuid4()

                print(f"Selected Datastore: {selected_ds}, Selected Bucket: {selected_bucket}")
                print(f"File Name: {file_name}, File Type: {file_type}, File Size: {file_size}")
            
                selected_datastore = Datastores.objects.get(datastore_name=selected_ds)
                selected_datastore.accessed_at = timezone.now()
                selected_datastore.save()

                selected_b = Buckets.objects.get(bucket_name=selected_bucket)
                selected_b.accessed_at = timezone.now()
                selected_b.save()

                api_endpoint = request.build_absolute_uri(request.path)  # Get the full API URL
                print(f"API Endpoint: {api_endpoint}") 

                # Create the object
                object_obj = Objects.objects.create(owner_id=owner_id, datastore_id=selected_datastore, bucket_id=selected_b,
                            file_id=file_id, file_name=file_name, file_type=file_type, file_size=file_size, 
                            file_path=f"{api_endpoint}/{str(file_name)}",
                            accessed_at=timezone.now())

                if object_obj:
                    print(f"Object with Name: {object_obj.file_name} accessed at {object_obj.accessed_at}")
                    return JsonResponse({'message': 'Object created successfully'}, status=200)

                else:
                    return JsonResponse({'error': 'Failed to create object'}, status=400)



            else:
                return JsonResponse({'error': 'No file uploaded'}, status=400)

                
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)
