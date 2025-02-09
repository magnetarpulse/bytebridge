from django.shortcuts import render, redirect
#from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .serializers import UploadedFileModelSerializer
from .models import *
from django.contrib.auth import authenticate, login
from django.contrib import messages
from django.contrib.auth.models import User
import uuid
from django.contrib.auth.decorators import login_required


def register_page(request):
    if request.method=='POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        print(f"{username}:{password}")
    
        user = User.objects.filter(username=username)
        if user.exists():
            messages.error(request, 'User already exists')
            return redirect('/register/')
        
        user = User.objects.create_user(username=username, password=password)
        user.set_password(password)
        user.save()
        messages.success(request, 'User created successfully')
        return redirect('/login/')
        
    return render(request, 'register.html')


def login_page(request):
    if request.method=='POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        print(f"{username}:{password}")
        
        if not User.objects.filter(username=username).exists():
            messages.error(request, 'User does not exist')
            return redirect('/login/')
        
        user = authenticate(username=username, password=password)

        if user is None:
            messages.error(request, 'Invalid credentials')
            return redirect('/login/')
        else:
            # Log in the user and redirect to the upload file page upon successful login
            login(request, user)
            # Check if the user already has a UserDatastore entry
            datastore_instance, created = UserDatastore.objects.get_or_create(
                 # This is the ForeignKey field
                user_id=user, 
                defaults={'username': username, 'password': password, 'datastore_id': uuid.uuid4()}
            )
            return redirect('/upload/')
    
    return render(request, 'login.html')




@login_required
def upload_file(request):
    if request.method=='POST':
        file = request.FILES.get('file')

        if not file:
            #return Response({'error': 'Please provide file'}, status=400)
            messages.error(request, 'Please provide file')
            return redirect('/upload/')

        try:
            datastore_instance = UserDatastore.objects.get(user_id=request.user)
            messages.success(request, 'File Uploaded Successfully')
        
        except UserDatastore.DoesNotExist:
            messages.error(request, 'User does not have a datastore')
            #return Response({'error': 'User does not have a datastore'}, status=404)

        uploaded_file = UploadedFileModel.objects.create(
            file_type = request.POST.get('file_type'),
            file=file,
            datastore_id=datastore_instance.datastore_id,
            user_id=request.user.id)
        uploaded_file.save()

        return render(request, 'upload_file.html', {'uploaded_file': uploaded_file})
    return render(request, 'upload_file.html')




'''class FileUploadView(APIView):
    def post(self, request, *args, **kwargs):
        file_serializer = UploadedFileModelSerializer(data=request.data)
        if file_serializer.is_valid():
            file_serializer.save()
            return Response(file_serializer.data, status=status.HTTP_201_CREATED)
        else:
            return Response(file_serializer.errors, status=status.HTTP_400_BAD_REQUEST)'''










