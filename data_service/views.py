import os
import requests
import json
import uuid
import mimetypes
import urllib.parse
import shutil # recursive delete all the contents of a directory
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
from django.db.models import Q

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
class CheckDatastoreAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data['owner_id']
            instance_id = data['instance_id']
            static_path = data['static_path']
            print(f"In BB CHeck: Owner ID: {owner_id}, Instance ID: {instance_id}, Static Path: {static_path}")

            bb_datastore = Datastores.objects.filter(bytebridge_id=instance_id, default=True)

            # If no datastore exists with the given instance_id and default=True, create a new one
            if not bb_datastore:
                bb_datastore = Datastores.objects.create(owner_id=owner_id,bytebridge_id=instance_id,
                    datastore_id=uuid.uuid4(), datastore_name=f"default-datastore-{owner_id}",
                    accessed_at=timezone.now())
                
                print(f"Datastore with ID: {bb_datastore.datastore_id} accessed at {bb_datastore.accessed_at}")

                if not static_path:
                    return JsonResponse({'error': 'Missing static path'}, status=400)

                else:
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
            static_path = data.get('static_path')

            if not selected_ds or private_permissions is None:  # Ensure required fields are present
                return JsonResponse({'error': 'Missing required parameters'}, status=400)

            try:
                selected_datastore = Datastores.objects.get(datastore_id=selected_ds, owner_id=owner_id)
            except Datastores.DoesNotExist:
                return JsonResponse({'error': 'Datastore not found'}, status=404)

            selected_datastore.accessed_at = timezone.now()
            updates_made = False  # Initialize updates flag
            
            # Check and update private permissions
            if private_permissions != selected_datastore.private_permissions:
                selected_datastore.private_permissions = private_permissions
                updates_made = True
                print(f"Datastore privacy updated to '{private_permissions}' for user {owner_id}")
            
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




@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class ListDatastoresAPI(APIView):
    def post(self, request):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            include_public = data.get('include_public', False)
            pub_comm = data.get('pub_comm', False)

            if not owner_id:
                return JsonResponse({'error': 'Missing owner_id'}, status=400)

            datastores_upload = []

            if pub_comm:
                public_ds_all = Datastores.objects.filter(~Q(private_permissions='private')).values_list('datastore_name', 'datastore_id') # exclude private datastores
                datastores_upload.extend(public_ds_all)

            else:
                # Always include user's own datastores
                user_specific_ds = Datastores.objects.filter(owner_id=owner_id).values_list('datastore_name', 'datastore_id')
                datastores_upload.extend(user_specific_ds)

                # If include_public = True, add public datastores as well
                if include_public:
                    public_ds_all = Datastores.objects.filter(private_permissions='community').exclude(owner_id=owner_id).values_list('datastore_name', 'datastore_id')
                    datastores_upload.extend(public_ds_all)    

            # Update accessed_at for each datastore
            datastore_ids = [datastore[1] for datastore in datastores_upload]
            Datastores.objects.filter(datastore_id__in=datastore_ids).update(accessed_at=timezone.now())

            print(f"Datastores Available for {owner_id}: {datastores_upload}")

            return JsonResponse({
                'message': 'Owner ID received by BB', 
                'datastores_upload': datastores_upload
            }, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)




# Retrieve all buckets for a user in a selected datastore.
def get_buckets_upload(owner_id, selected_datastore):
    buckets_upload = list(
    Buckets.objects.filter(datastore_id=selected_datastore, owner_id=owner_id)
    .values_list('bucket_name', 'bucket_id')
    )

    public_buckets = list(
        Buckets.objects.filter(datastore_id=selected_datastore, private_permissions='community')
        .exclude(owner_id=owner_id)
        .values_list('bucket_name', 'bucket_id')
    )

    buckets_upload.extend(public_buckets)  

    print(f"All buckets: {buckets_upload}") 
    if buckets_upload:
        bucket_ids = [bucket[1] for bucket in buckets_upload]
        Buckets.objects.filter(bucket_id__in=bucket_ids).update(accessed_at=timezone.now())
    
    return buckets_upload




# api to list all the buckets from the user with/without datastore
@authentication_classes([CentralAuthServiceAuthentication])
@permission_classes([IsAuthenticated])
class ListBucketsAPI(APIView):
    def post(self, request,selected_ds=None):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            dataset_type = data.get('dataset_type')
            privacy_bucket = data.get('privacy_bucket')
            print(f"Received on BB Privacy Bucket: {privacy_bucket}")
            print(f"Selected Datastore on BB: {selected_ds}")
            if selected_ds:

                # Retrieve the datastore object for foreign key in buckets table
                selected_datastore = Datastores.objects.get(datastore_id=selected_ds)
                selected_datastore.accessed_at = timezone.now()
                selected_datastore.save()
            
                if privacy_bucket=='private':
                    
                    bucket_qs = Buckets.objects.filter(datastore_id=selected_datastore,owner_id=owner_id,private_permissions='private')
                    
                    bucket_qs.update(accessed_at=timezone.now())
                    dataset_bucket = [{'bucket_name': b.bucket_name, 'bucket_id': str(b.bucket_id)}for b in bucket_qs]

                    if dataset_bucket:
                        print(f"Private Buckets: {dataset_bucket}")
                        return JsonResponse({'message': 'Private Buckets','dataset_bucket': dataset_bucket}, status=200)
                    else:
                        return JsonResponse({'message': 'No private buckets found'}, status=201)

                if privacy_bucket=='public':
                    
                    bucket_qs = Buckets.objects.filter(datastore_id=selected_datastore,owner_id=owner_id,private_permissions='public')

                    bucket_qs.update(accessed_at=timezone.now())
                    dataset_bucket = [{'bucket_name': b.bucket_name, 'bucket_id': str(b.bucket_id)}for b in bucket_qs]


                    if dataset_bucket:
                        print(f"Public Buckets: {dataset_bucket}")
                        return JsonResponse({'message': 'Public Buckets','dataset_bucket': dataset_bucket}, status=200)
                    else:
                        return JsonResponse({'message': 'No public buckets found'}, status=201)
            
                if dataset_type:
                
                    # Case 1: Datastore is private → All buckets for that user are private
                    if selected_datastore.private_permissions == 'private':
                        
                        #buckets_qs = Buckets.objects.filter(datastore_id=selected_datastore,private_permissions='private', owner_id=owner_id)
                        buckets_qs = Buckets.objects.filter(datastore_id=selected_datastore, owner_id=owner_id)
                        buckets_qs.update(accessed_at=timezone.now())
                        buckets_upload = list(buckets_qs.values_list('bucket_name', 'bucket_id'))
                        print(f"[PRIVATE DATASTORE] Buckets: {buckets_upload}")
                        return JsonResponse({'message': 'Buckets', 'buckets_upload': buckets_upload}, status=200)
                    
                    # Case 2: Datastore is public/community
                    else:
                        if dataset_type == 'private':
                            
                            buckets_qs = Buckets.objects.filter(datastore_id=selected_datastore, private_permissions='private', owner_id=owner_id)
                            buckets_qs.update(accessed_at=timezone.now())
                            buckets_upload = list(buckets_qs.values_list('bucket_name', 'bucket_id'))
                            print(f"[PUBLIC DATASTORE] PRIVATE Buckets: {buckets_upload}")
                        
                        elif dataset_type == 'public':
                            # Get public/community buckets from that datastore
                            buckets_qs = Buckets.objects.filter(datastore_id=selected_datastore, private_permissions='public')
                            buckets_qs.update(accessed_at=timezone.now())
                            buckets_upload = list(buckets_qs.values_list('bucket_name', 'bucket_id'))
                            print(f"[PUBLIC DATASTORE] PUBLIC Buckets: {buckets_upload}")
                        
                        return JsonResponse({'message': 'Buckets', 'buckets_upload': buckets_upload}, status=200)

                else:
                    if not owner_id:
                        return JsonResponse({'error': 'Missing owner_id'}, status=400)

                    if selected_ds:
                        # Case 1: Buckets for a specific datastore (including public)
                        print(f"Selected Datastore: {selected_ds}")
                        selected_datastore = Datastores.objects.get(datastore_id=selected_ds)
                        selected_datastore.accessed_at = timezone.now()
                        selected_datastore.save()

                        buckets_upload = get_buckets_upload(owner_id, selected_datastore)

                        if buckets_upload:
                            return JsonResponse({'message': 'Buckets from selected datastore', 'buckets_upload': buckets_upload}, status=200)
                        else:
                            return JsonResponse({'message': 'No buckets found in the selected datastore'}, status=201)

                    # else:
                    #     # Case 2: All buckets owned by the user (across all datastores)
                    #     buckets_qs = Buckets.objects.filter(datastore_id=selected_datastore)
                    #     buckets_qs.update(accessed_at=timezone.now())
                    #     buckets_upload = list(buckets_qs.values_list('bucket_name', 'bucket_id'))

                    #     for bucket in buckets_upload:
                    #         bucket_obj = Buckets.objects.get(bucket_name=bucket[0], bucket_id=bucket[1], owner_id=owner_id)
                    #         bucket_obj.accessed_at = timezone.now()
                    #         bucket_obj.save()

                    #     print(f"All buckets owned by {owner_id}: {buckets_upload}")

                    #     return JsonResponse({'message': 'All buckets owned by user', 'buckets_upload': buckets_upload}, status=200)

            else:
                return JsonResponse({'error': 'Missing required parameters'}, status=400)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)
        except Datastores.DoesNotExist:
            return JsonResponse({'error': 'Selected datastore not found'}, status=404)



# api to create a bucket for the user
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class CreateBuckets(APIView):
    def post(self, request, selected_ds=None):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            bucket_name = data.get('bucket_name')
            static_path = data.get('static_path')
            private_permissions= data.get('private_permissions',None)
            #default = data.get('default', False)
            privacy_bucket = data.get('privacy_bucket', '')

            print(f"Selected Datastore: {selected_ds}")
            print(f"Bucket Name: {bucket_name}")

            selected_datastore = Datastores.objects.get(datastore_id=selected_ds)
            selected_datastore.accessed_at = timezone.now()
            selected_datastore.save()

            # Retrieve updated list of buckets
            buckets_upload = get_buckets_upload(owner_id, selected_datastore)

            
            existing_def_bucket = Buckets.objects.filter(datastore_id=selected_datastore, owner_id=owner_id, private_permissions=privacy_bucket).first()

            if existing_def_bucket:
                print(f"Existing Default Bucket: {existing_def_bucket}") 
                existing_def_bucket.accessed_at = timezone.now()
                existing_def_bucket.save()
                return JsonResponse({'message': 'Default Bucket for owner already exists', 'buckets_upload': buckets_upload, 'created_bucket': existing_def_bucket.bucket_id}, status=200)

            bucket_obj = Buckets.objects.create(datastore_id=selected_datastore,owner_id=owner_id,bucket_name=bucket_name,
                private_permissions=private_permissions,bucket_id=uuid.uuid4(),accessed_at=timezone.now(),)

            if bucket_obj:
                print(f"Bucket with ID: {bucket_obj.bucket_id} accessed at {bucket_obj.accessed_at}")
                
                return JsonResponse({'message': 'Bucket created successfully', 'buckets_upload': buckets_upload, 'created_bucket': bucket_obj.bucket_id}, status=200)

            return JsonResponse({'error': 'Failed to create bucket'}, status=400)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)


# api to create an object for the user
@authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
@permission_classes([IsAuthenticated])
class CreateObjects(APIView):
    def post(self, request, selected_ds=None, selected_bucket=None):
        try:
            owner_id = request.POST.get('owner_id')
            static_path = request.POST.get('static_path')
            file = request.FILES.get('file')  # Get file from request.FILES
            file_type = request.POST.get('file_type')
            print(f"Static Path: {static_path}")

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

                # Create the object                
                object_obj = Objects.objects.create(bucket_id=selected_b,
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



# api to list all datasets for the user
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class ListObjects(APIView):
    def post(self,request,selected_ds=None, selected_bucket=None):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            dataset_type = data.get('dataset_type')
            datasets=[]
            print(f"Received on BB = Owner ID: {owner_id}, Dataset Type: {dataset_type}")
            print(f"Selected Datastore: {selected_ds}, Selected Bucket: {selected_bucket}")
            
            selected_b= Buckets.objects.get(bucket_id=selected_bucket)
            selected_b.accessed_at = timezone.now()
            selected_b.save()

            object_obj = Objects.objects.filter(bucket_id=selected_b).values_list('file_id', 'file_name', 'file_path', 'uploaded_at', 'file_size')

            bucket_owner = selected_b.owner_id # for dataset to inherit bucket owner permissions

            for obj in object_obj:
                obj_with_owner = list(obj)  # Convert tuple to list to allow modification
                obj_with_owner.append(bucket_owner)  # Add bucket owner_id
                datasets.append(obj_with_owner) 

            selected_b.accessed_at = timezone.now() 
            object_obj.accessed_at = timezone.now()
            print(f"Datasets: {datasets}")
            return JsonResponse({'message': 'Dataset received by BB', 'datasets':datasets}, status=200)

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)
        


# method to trigger the uploading of files to the datastore/bucket
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
    

# api to view a file from the datastore
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class ViewObject(APIView):
    def post(self,request,file_id=None):
        try:
            data = json.loads(request.body.decode("utf-8"))
            file_path = data.get('file_path')
            
            print(f"Received on BB = File ID: {file_id}")
            
            obj = Objects.objects.get(file_id=file_id)
            obj.accessed_at = timezone.now()

            decoded_file_path = urllib.parse.unquote(file_path)  # Ensure it's decoded once
            full_path = os.path.join(settings.DATASTORE_ROOT, decoded_file_path)

            print(f"Decoded Path: {decoded_file_path}")
            print(f"Full Path: {full_path}")

            if os.path.exists(full_path):
                encoded_file_path = urllib.parse.quote(decoded_file_path, safe="/")

                file_url = f"{request.build_absolute_uri(settings.DATASTORE_URL)}{encoded_file_path}"
                content_type = mimetypes.guess_type(full_path)[0] or 'application/octet-stream'
                file_name = os.path.basename(full_path)
                file_size = obj.file_size
                print(f"File URL: {file_url}")
                print(f"Content-Type: {content_type}")

                return Response({'file_path': file_url, 'content_type': content_type, 'file_name':file_name, 'file_size':file_size}, status=200)
            
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
class DeleteObject(APIView):
    def post(self,request,file_id=None):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
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



# api to delete a file from the datastore
@authentication_classes([CentralAuthServiceAuthentication])  
@permission_classes([IsAuthenticated])
class DeleteBuckets(APIView):
    def post(self,request,selected_ds=None, selected_bucket=None):
        try:
            data = json.loads(request.body.decode("utf-8"))
            owner_id = data.get('owner_id')
            print(f"Received on BB for deletion = Owner ID: {owner_id}, Selected Datastore: {selected_ds}, Selected Bucket: {selected_bucket}")

            bucket_obj = Buckets.objects.filter(bucket_id=selected_bucket, owner_id=owner_id).first()

            if bucket_obj:
                bucket_obj.accessed_at = timezone.now()
                bucket_obj.delete() # from database

                datastore_path = os.path.join(settings.DATASTORE_ROOT, selected_ds)
                bucket_path = os.path.join(datastore_path, selected_bucket)
                
                # Delete the bucket directory
                if os.path.exists(bucket_path):
                    shutil.rmtree(bucket_path)
                    print(f"Bucket directory deleted: {bucket_path}")
                    print(f"Bucket with ID: {selected_bucket} deleted successfully")
                return JsonResponse({'message': 'Bucket deleted successfully'}, status=200)
            else:
                print(f"Bucket with ID: {selected_bucket} not found or not owned by user")
                return JsonResponse({'error': 'Bucket can only be deleted by its Owner'}, status=404)
                        
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON format'}, status=400)





# api to change the settings of a bucket for the user
# @authentication_classes([CentralAuthServiceAuthentication])  #  Use new authentication
# @permission_classes([IsAuthenticated])
# class Change_Bucket_Settings(APIView):
#     def post(self, request):
#         try:
#             data = json.loads(request.body.decode("utf-8"))
#             owner_id = data.get('owner_id')
#             selected_bucket = data.get('selected_bucket')
#             private_permissions = data.get('private_permissions')
#             bucket_name = data.get('bucket_name')

#             if not selected_bucket or private_permissions is None:  # Ensure required fields are present
#                 return JsonResponse({'error': 'Missing required parameters'}, status=400)

#             try:
#                 selected_bucket = Buckets.objects.get(bucket_id=selected_bucket, owner_id=owner_id)
#             except Datastores.DoesNotExist:
#                 return JsonResponse({'error': 'Bucket not found'}, status=404)

#             selected_bucket.accessed_at = timezone.now()
#             updates_made = False  # Initialize updates flag

#             # Check and update private permissions
#             if private_permissions != selected_bucket.private_permissions:
#                 selected_bucket.private_permissions = private_permissions
#                 updates_made = True
#                 print(f"Bucket privacy updated to '{private_permissions}' for user {owner_id}")
            

#             # Check and update datastore name
#             if bucket_name and bucket_name != selected_bucket.bucket_name:
#                 selected_bucket.bucket_name = bucket_name
#                 updates_made = True
#                 print(f"Bucket name updated to {bucket_name} for user {owner_id}")

#             # Save changes only if updates were made
#             if updates_made:
#                 selected_bucket.save()
#                 return JsonResponse({'message': 'Bucket settings updated successfully'}, status=200)
#             else:
#                 return JsonResponse({'message': 'No changes were made'}, status=200)

#         except json.JSONDecodeError:
#             return JsonResponse({'error': 'Invalid JSON format'}, status=400)

#         except Exception as e:

#             return JsonResponse({'error': f'Error: {str(e)}'}, status=500)