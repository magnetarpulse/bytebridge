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
# Create your views here.
from django.shortcuts import render
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from .authentication import CentralAuthServiceAuthentication
from django.http import JsonResponse, FileResponse, Http404
from rest_framework.decorators import api_view
from rest_framework.permissions import AllowAny
from rest_framework.decorators import api_view, permission_classes

# api to connect bb with nc
# NC_connect_url = 'http://127.0.0.1:8000/api/nc_connect'


NEUROBAZAAR_BASE_URL = os.getenv("NEUROBAZAAR_BASE_URL", "http://127.0.0.1:8000")  # default for local dev
NC_connect_url = f"{NEUROBAZAAR_BASE_URL}/api/nc_connect"


@api_view(['GET'])
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
def home_view(request):
    user = request.user
    return render(request, "home.html", {"username": user.username})

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
            # response_data = response.json()
            
            # username = response_data['username']
            # owner_id = response_data['owner_id']
            # instance_id = response_data['instance_id']
            # datastore_id = response_data['datastore_id']
            # datastore_name = response_data['datastore_name']
            
            # print(f"Received data from NC: {username}:{owner_id}:{instance_id}:{datastore_id}:{datastore_name}")
            
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


EXPOSED_FOLDER_PATH = r"C:\Users\Rushikesh\Desktop\images"

@api_view(['GET'])
@permission_classes([AllowAny])
def list_files(request):
    try:
        files = os.listdir(EXPOSED_FOLDER_PATH)
        return JsonResponse({"files": files})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

@api_view(['GET'])
@permission_classes([AllowAny])
def serve_file(request, filename):
    file_path = os.path.join(EXPOSED_FOLDER_PATH, filename)
    if os.path.exists(file_path):
        return FileResponse(open(file_path, 'rb'))
    else:
        raise Http404("File not found.")
    
import os
from django.http import HttpResponse, HttpResponseForbidden, HttpResponseNotFound
from django.conf import settings

from django.http import FileResponse
import urllib

def fetch_file(request):
    access_key = request.GET.get("access_key")
    filename = request.GET.get("name")

    with open("access_key.txt", "r") as f:
        valid_key = f.read().strip()

    if access_key != valid_key:
        return HttpResponseForbidden("Invalid access key.")

    file_path = os.path.join(EXPOSED_FOLDER_PATH, filename)

    if os.path.exists(file_path):
        response = FileResponse(open(file_path, "rb"), content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="{urllib.parse.quote(filename)}"'
        return response
    else:
        return HttpResponseNotFound("File not found.")

