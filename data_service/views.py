import os
import requests
import json
import uuid
import urllib.parse
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
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.core.files import File

from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from .authentication import CentralAuthServiceAuthentication


# api to connect bb with nc
NC_connect_url = 'http://127.0.0.1:8000/api/nc_connect'


# after authentication get the user to the home page from NC
@api_view(['GET'])
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
def home_view(request):
    user = request.user
    payload = {'username': user.username}
    try:
        response = requests.post(NC_connect_url, json=payload, timeout=5)
    
        if response.status_code == 200:
            print("Connection with NC successful")
            return HttpResponse(response.content)
                
        else:
            return JsonResponse({'error': 'Failed to connect'}, status=response.status_code)

    except requests.exceptions.RequestException as e:
        return JsonResponse({'error': 'Connection error', 'details': str(e)}, status=500)
    

# api to create a datastore for the user
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class CreateDatastoreAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data['owner_id']
            instance_id = data['instance_id']
            static_path = data['static_path']
            print(f"In BB CHeck: Owner ID: {owner_id}, Instance ID: {instance_id}, Static Path: {static_path}")

            bb_datastore = Datastores.objects.filter(instance_id=instance_id, default=True)

            # If no datastore exists with the given instance_id and default=True, create a new one
            if not bb_datastore:
                bb_datastore = Datastores.objects.create(owner_id=owner_id,instance_id=instance_id,
                    datastore_id=uuid.uuid4(), datastore_name=f"default-datastore-{owner_id}",
                    accessed_at=timezone.now(),)
                
                print(f"Datastore with ID: {bb_datastore.datastore_id} accessed at {bb_datastore.accessed_at}")

                if not static_path:
                    return JsonResponse({'error': 'Missing static path'}, status=400)

                else:
                    #os.makedirs(f"{static_path}/{str(bb_datastore.datastore_id)}", exist_ok=True)
                    print('Directory created successfully')

            return JsonResponse({'message': 'Endpoint received by BB'}, status=200)
        
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)
    


# api to change the settings of a datastore for the user
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class Change_DS_Settings(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_ds = data.get('selected_ds')
            private_permissions = data.get('private_permissions')
            datastore_name = data.get('datastore_name')

            if not selected_ds or private_permissions is None:  # Ensure required fields are present
                return JsonResponse({'error': 'Missing required parameters'}, status=400)

            try:
                selected_datastore = Datastores.objects.get(datastore_id=selected_ds, owner_id=owner_id)
            except Datastores.DoesNotExist:
                return JsonResponse({'error': 'Datastore not found'}, status=404)

            selected_datastore.accessed_at = timezone.now()
            updates_made = False  # Initialize updates flag

            # Check and update private permissions
            new_value = private_permissions == 'private'
            if new_value != selected_datastore.private_permissions:
                selected_datastore.private_permissions = new_value
                updates_made = True
                print(f"Datastore privacy updated to {private_permissions} for user {owner_id}")

            # Check and update datastore name
            if datastore_name and datastore_name != selected_datastore.datastore_name:
                selected_datastore.datastore_name = datastore_name
                updates_made = True
                print(f"Datastore name updated to {datastore_name} for user {owner_id}")

            # Save changes only if updates were made
            if updates_made:
                selected_datastore.save()
                return JsonResponse({'message': 'Datastore settings updated successfully'}, status=200)
            else:
                return JsonResponse({'message': 'No changes were made'}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)

        except Exception as e:
            return JsonResponse({'error': f'Error: {str(e)}'}, status=500)



# api to change the settings of a bucket for the user
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class Change_Bucket_Settings(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_bucket = data.get('selected_bucket')
            private_permissions = data.get('private_permissions')
            bucket_name = data.get('bucket_name')

            if not selected_bucket or private_permissions is None:  # Ensure required fields are present
                return JsonResponse({'error': 'Missing required parameters'}, status=400)

            try:
                selected_bucket = Buckets.objects.get(bucket_id=selected_bucket, owner_id=owner_id)
            except Datastores.DoesNotExist:
                return JsonResponse({'error': 'Bucket not found'}, status=404)

            selected_bucket.accessed_at = timezone.now()
            updates_made = False  # Initialize updates flag

            # Check and update private permissions
            new_value = private_permissions == 'private'
            if new_value != selected_bucket.private_permissions:
                selected_bucket.private_permissions = new_value
                updates_made = True
                print(f"Bucket privacy updated to {private_permissions} for user {owner_id}")

            # Check and update datastore name
            if bucket_name and bucket_name != selected_bucket.bucket_name:
                selected_bucket.bucket_name = bucket_name
                updates_made = True
                print(f"Bucket name updated to {bucket_name} for user {owner_id}")

            # Save changes only if updates were made
            if updates_made:
                selected_bucket.save()
                return JsonResponse({'message': 'Bucket settings updated successfully'}, status=200)
            else:
                return JsonResponse({'message': 'No changes were made'}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)

        except Exception as e:

            return JsonResponse({'error': f'Error: {str(e)}'}, status=500)


# api to send all datastores owned by the user to NC
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class SendUserDatastoresAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')

            print(f"Owner ID sent by NC: {owner_id}")

            if not owner_id:
                return JsonResponse({'error': 'Missing owner_id'}, status=400)

            all_datastores = list(Datastores.objects.filter(owner_id=owner_id).values_list('datastore_name', 'datastore_id'))

            for datastore in all_datastores:
                datastore_obj = Datastores.objects.get(datastore_name=datastore[0], datastore_id = datastore[1], owner_id=owner_id)
                datastore_obj.accessed_at = timezone.now()
                datastore_obj.save()

            print(f"All datastores owned by {owner_id}: {all_datastores}")

            return JsonResponse({'message': 'Owner ID received by BB', 'all_datastores': all_datastores}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)



# api to send all datastores owned by the user to NC
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class SendAllDatastoresAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')

            self.datastores_upload = []
            # user datastores
            user_specific_ds = Datastores.objects.filter(owner_id=owner_id).values_list('datastore_name', 'datastore_id')
            
            self.datastores_upload.extend(user_specific_ds)

            # Get all public datastores except the user's own
            public_ds_all = Datastores.objects.filter(private_permissions=False).exclude(owner_id=owner_id).values_list('datastore_name', 'datastore_id')
            self.datastores_upload.extend(public_ds_all)

            for datastore in self.datastores_upload:
                datastore_obj = Datastores.objects.get(datastore_id=datastore[1])
                datastore_obj.accessed_at = timezone.now()
                datastore_obj.save()

            print(f"Public datastores Available for {owner_id}: {self.datastores_upload}")
            
            return JsonResponse({'message': 'Owner ID received by BB', 'datastores_upload': self.datastores_upload}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)


@authentication_classes([CentralAuthServiceAuthentication]) 
@permission_classes([IsAuthenticated])
def get_all_ds(owner_id, selected_datastore):
    """ Retrieve all buckets for a user in a selected datastore. """
    buckets_upload = list(
    Buckets.objects.filter(datastore_id=selected_datastore, owner_id=owner_id)
    .values_list('bucket_name', 'bucket_id')
    )

    public_buckets = list(
        Buckets.objects.filter(datastore_id=selected_datastore, private_permissions=False)
        .exclude(owner_id=owner_id)
        .values_list('bucket_name', 'bucket_id')
    )

    buckets_upload.extend(public_buckets)  

    print(f"All buckets: {buckets_upload}") 
    if buckets_upload:
        bucket_ids = [bucket[1] for bucket in buckets_upload]
        Buckets.objects.filter(bucket_id__in=bucket_ids).update(accessed_at=timezone.now())
    
    return buckets_upload



@authentication_classes([CentralAuthServiceAuthentication]) 
@permission_classes([IsAuthenticated])
class SendAllBuckets(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_ds = data.get('selected_ds')

            print(f"Selected Datastore: {selected_ds}")

            selected_datastore = Datastores.objects.get(datastore_id=selected_ds)
            selected_datastore.accessed_at = timezone.now()
            selected_datastore.save()

            # Retrieve buckets using the reusable function
            buckets_upload = get_all_ds(owner_id, selected_datastore) # pass the selected_datastore instance

            if buckets_upload:
                return JsonResponse({'message': 'Buckets sent from bb', 'buckets_upload': buckets_upload}, status=200)
            else:
                return JsonResponse({'message': 'No bucket found, create a bucket'}, status=201)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)



# api to send all buckets owned by the user to NC
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class SendUserBucketAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')

            print(f"Owner ID sent by NC: {owner_id}")

            if not owner_id:
                return JsonResponse({'error': 'Missing owner_id'}, status=400)

            all_buckets = list(Buckets.objects.filter(owner_id=owner_id).values_list('bucket_name', 'bucket_id'))

            for bucket in all_buckets:
                bucket_obj = Buckets.objects.get(bucket_name=bucket[0], bucket_id = bucket[1], owner_id=owner_id)
                bucket_obj.accessed_at = timezone.now()
                bucket_obj.save()

            print(f"All datastores owned by {owner_id}: {all_buckets}")

            return JsonResponse({'message': 'Owner ID received by BB', 'all_buckets': all_buckets}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)
    



# api to create a bucket for the user
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class CreateBuckets(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            selected_ds = data.get('selected_ds')
            bucket_name = data.get('bucket_name')
            static_path = data.get('static_path')
            private_permissions= data.get('private_permissions',None)
            default = data.get('default', False)

            if private_permissions is None:
                private_permissions = False
            

            print(f"Selected Datastore: {selected_ds}")
            print(f"Bucket Name: {bucket_name}")

            selected_datastore = Datastores.objects.get(datastore_id=selected_ds)
            selected_datastore.accessed_at = timezone.now()
            selected_datastore.save()

            # Create the bucket
            bucket_obj = Buckets.objects.create(
                datastore_id=selected_datastore,
                owner_id=owner_id,
                bucket_name=bucket_name,
                private_permissions=private_permissions,
                default=default,
                bucket_id=uuid.uuid4(),
                accessed_at=timezone.now(),
            )

            if bucket_obj:
                print(f"Bucket with ID: {bucket_obj.bucket_id} accessed at {bucket_obj.accessed_at}")

                # Create directory
                #os.makedirs(f"{static_path}/{selected_ds}/{bucket_obj.bucket_id}", exist_ok=True)
                print('Directory created successfully')

                # Retrieve updated list of buckets
                buckets_upload = get_all_ds(owner_id, selected_datastore)

                return JsonResponse({'message': 'Bucket created successfully', 'buckets_upload': buckets_upload, 'created_bucket': bucket_obj.bucket_id}, status=200)

            return JsonResponse({'error': 'Failed to create bucket'}, status=400)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)


# api to create an object for the user
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
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
            
                selected_datastore = Datastores.objects.get(datastore_id=selected_ds)
                selected_datastore.accessed_at = timezone.now()
                selected_datastore.save()

                selected_b = Buckets.objects.get(bucket_id=selected_bucket)
                selected_b.accessed_at = timezone.now()
                selected_b.save()

                #api_endpoint = f"{request.build_absolute_uri(request.path)}/{selected_bucket}" # Get the full API URL
                #print(f"API Endpoint: {api_endpoint}") 

                # Create the object
                object_obj = Objects.objects.create(owner_id=owner_id, datastore_id=selected_datastore, bucket_id=selected_b,
                            file_id=file_id, file_name=file_name, file_type=file_type, file_size=file_size, 
                            file_path=f"{selected_ds}/{selected_bucket}/{file_name}",
                            accessed_at=timezone.now())

                if object_obj:
                    print(f"Object with Name: {object_obj.file_name} accessed at {object_obj.accessed_at}")
                    upload_file(static_path, file, object_obj.file_id, selected_ds, selected_bucket)
                    print('File uploaded successfully')
                    return JsonResponse({'message': 'Object created successfully'}, status=200)

                else:
                    return JsonResponse({'error': 'Failed to create object'}, status=400)
            else:
                return JsonResponse({'error': 'No file uploaded'}, status=400)
    
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)



# api to upload a file to the datastore
@authentication_classes([CentralAuthServiceAuthentication]) 
@permission_classes([IsAuthenticated])
def upload_file(static_path, file, file_id, datastore_id, bucket_id):
    print(f"static_path: {static_path}")
    print(f"file: {file}")
    print(f"File id: {file_id}")

    abs_path = os.path.join(static_path, str(datastore_id), str(bucket_id))

    os.makedirs(abs_path, exist_ok=True)  # Ensure the directory exists
    print(f"Absolute path: {abs_path}")
    
    file_path = os.path.join(abs_path, file.name)

    print(f"File path: {file_path}")
    
    with open(file_path, 'wb+') as destination:
        for chunk in file.chunks():
            destination.write(chunk)
    
    

# api to list all datasets for the user
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class List_Datasets(APIView):
    def post(self,request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            dataset_type = data.get('dataset_type')
            print(f"Received on BB = Owner ID: {owner_id}, Dataset Type: {dataset_type}")
            datasets=[]
            buckets_for_datasets=[]

            if owner_id and dataset_type:
                if dataset_type=='private':
                    private_buckets = Buckets.objects.filter(owner_id=owner_id, private_permissions=True)
                    buckets_for_datasets.extend(private_buckets)
                    private_buckets.accessed_at = timezone.now()
                    
                    
                    print(f"Private Buckets: {buckets_for_datasets}")

                    for bucket in buckets_for_datasets:
                        object_obj = Objects.objects.filter(owner_id=owner_id, bucket_id = bucket).values_list('file_id', 'file_name', 'file_path', 'uploaded_at', 'file_size', 'owner_id')
                        datasets.extend(object_obj)
                        object_obj.accessed_at = timezone.now()
                        

                        print(f"Private Datasets: {datasets}")
                

                elif dataset_type=='public':
                    public_buckets = Buckets.objects.filter(private_permissions=False)
                    buckets_for_datasets.extend(public_buckets)
                    
                    for bucket in buckets_for_datasets:
                        object_obj = Objects.objects.filter(bucket_id = bucket).values_list('file_id', 'file_name', 'file_path', 'uploaded_at','file_size','owner_id')
                        datasets.extend(object_obj)
                        object_obj.accessed_at = timezone.now()
                        

                        print(f"Public Datasets: {datasets}")

                elif dataset_type=='image_collections':
                    print(f"Image Collection requested by {owner_id}")
        
                return JsonResponse({'message': 'Dataset received by BB', 'datasets':datasets}, status=200)
            
            else:
                return JsonResponse({'error': 'Missing required parameters'}, status=400)
                        

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)



# api to view a file from the datastore
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class ViewFile(APIView):
    def post(self,request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            #owner_id = data.get('owner_id')
            file_id = data.get('file_id')
            file_path = data.get('file_path')
            
            print(f"Received on BB = File ID: {file_id}")
            
            obj = Objects.objects.get(file_id=file_id)
            obj.accessed_at = timezone.now()

            decoded_file_path = urllib.parse.unquote(file_path)  # Ensure it's decoded once
            full_path = os.path.join(settings.DATASTORE_ROOT, decoded_file_path)

            print(f"Decoded Path: {decoded_file_path}")
            print(f"Full Path: {full_path}")

            if os.path.exists(full_path):
                
                # Ensure file_path is properly encoded (without double encoding)
                if '%' in file_path:  # If already encoded, don't re-encode
                    encoded_file_path = file_path
                else:
                    encoded_file_path = urllib.parse.quote(file_path, safe="/")  # Only encode spaces

                # Construct the absolute URL
                file_url = f"{request.build_absolute_uri(settings.DATASTORE_URL)}{encoded_file_path}"
                print(f"File URL: {file_url}")
                return Response({'file_path': file_url}, status=200)
            
            else:
                # Return a proper response if file is not found
                print("File not found:", full_path)
                return Response({'error': 'File not found'}, status=404)

        except Exception as e:
            print("Error:", str(e))
            return Response({'error': str(e)}, status=500)


# api to delete a file from the datastore
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class BB_Delete_File(APIView):
    def post(self,request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            file_id = data.get('file_id')
            dataset_type = data.get('dataset_type')

            print(f"Received on BB = Owner ID: {owner_id}, File ID: {file_id}, Dataset Type: {dataset_type}")

            file_obj = Objects.objects.get(file_id=file_id)
            file_obj.accessed_at = timezone.now()
            file_obj.delete()
            print(f"File with ID: {file_id} deleted successfully")
            
            file_path = file_obj.file_path
            decoded_file_path = urllib.parse.unquote(file_path)  # Ensure it's decoded once
            full_path = os.path.join(settings.DATASTORE_ROOT, decoded_file_path)
            print(f"Decoded Path: {decoded_file_path}")
            print(f"Full Path: {full_path}")

            if os.path.exists(full_path):
                os.remove(full_path)
                print(f"File deleted from path: {full_path}")
                return JsonResponse({'message': 'File deleted successfully'}, status=200)
            
            else:
                print("File not found for deletion:", full_path)
                return JsonResponse({'error': 'File not found'}, status=404)
            
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)