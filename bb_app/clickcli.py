import argparse
import os
import uuid
import django
import sys
import django.utils
import datetime
from django.utils import timezone

sys.path.append(os.path.dirname(os.path.dirname(__file__))) 
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bytebridge.settings')
django.setup()

#from bb_app.models import UploadedFileModel
from bb_app.models import Datastores, Buckets
import uuid
DEFAULT_OWNER_ID = 1
# MANAGE DATASTORES SECTION
def add_datastore(datastore_name, instance_id=None, owner_id = DEFAULT_OWNER_ID, ):
    
    # Generate a UUID for datastore_id
    datastore_id = uuid.uuid4()

    datastore = Datastores.objects.create(
        owner_id=owner_id,
        instance_id=instance_id or uuid.uuid4(),
        datastore_id=datastore_id,
        datastore_name=datastore_name,
        private_permissions=True,
        default=True,
        accessed_at=timezone.now()  # <- timezone-aware now()
    )

    print(f"Datastore '{datastore_name}' was created successfully with ID {datastore.datastore_id}")

        
def delete_datastore(datastore_name):
    from bb_app.models import Datastores

    matches = Datastores.objects.filter(datastore_name=datastore_name)

    if not matches.exists():
        print(f"No datastore found with name '{datastore_name}'.")
        return

    if matches.count() == 1:
        matches.first().delete()
        print(f"Datastore '{datastore_name}' deleted successfully.")
    else:
        print(f"There are multiple datastores found with the same name '{datastore_name}':\n")
        for ds in matches:
            print(f"- ID: {ds.datastore_id}, Name: {ds.datastore_name}, Instance ID: {ds.instance_id}, Accessed At: {ds.accessed_at}")
        print("\nPlease use  delete-datastore-by-id uuid  to delete a specific datastore.")

def delete_datastore_by_id(datastore_id):
    from bb_app.models import Datastores
    import uuid

    try:
        ds_uuid = uuid.UUID(datastore_id)
    except ValueError:
        print("Invalid UUID format.")
        return

    try:
        datastore = Datastores.objects.get(datastore_id=ds_uuid)
        datastore.delete()
        print(f"Datastore with ID {datastore_id} deleted successfully.")
    except Datastores.DoesNotExist:
        print(f"No datastore found with ID {datastore_id}.")

        
#def list_datastores():
  #  datastores = UserDatastore.objects.all()
  #  for datastore in datastores:
  #      print(f"{datastore.datastore_id} - {datastore.description}")

def list_datastores(user_id):
    from bb_app.models import Datastores

    datastores = Datastores.objects.filter(owner_id=user_id)
    if not datastores:
        print(f"No datastores found for user ID {user_id}")
        return

    for d in datastores:
        print(f"Datastore ID: {d.datastore_id} Name: {d.datastore_name} | Private: {d.private_permissions} | Created: {d.created_at}")



# MANAGE BUCKETS SECTION

def create_bucket(datastore, bucket_name, owner_id):
    bucket = Buckets.objects.create(
        bucket_name=bucket_name,
        datastore_id=datastore,
        owner_id= DEFAULT_OWNER_ID, 
        accessed_at=datetime.datetime.now()
    )
    print(f"A Bucket created with ID: {bucket.bucket_id} and name: {bucket.bucket_name}")

def add_bucket(bucket_name, datastore_name, owner_id = DEFAULT_OWNER_ID):
    count = 0
    try:
        datastores = Datastores.objects.filter(datastore_name=datastore_name, owner_id = DEFAULT_OWNER_ID)
        count = datastores.count()
    except Datastores.DoesNotExist:
        print(f"Datastore with name {datastore_name} not found")
        return
    if count == 1:
        create_bucket(datastores.first(), bucket_name, owner_id = DEFAULT_OWNER_ID)
    elif count > 1:
        print(f"Multiple datastores found with the name {datastore_name}")
        print("Use `add-bucket-by-id` with one of the following datastore IDs for that specific datastore name:")
        for d in datastores:
            print(f"ID: {d.datastore_id} | Instance ID: {d.instance_id} | Created: {d.created_at}")

def add_bucket_by_id(bucket_name, datastore_id, owner_id = DEFAULT_OWNER_ID):
    try:
        datastore = Datastores.objects.get(datastore_id=datastore_id, owner_id =DEFAULT_OWNER_ID)
        create_bucket(datastore, bucket_name,owner_id = DEFAULT_OWNER_ID)
    except Datastores.DoesNotExist:
        print(f"Datastore with ID {datastore_id} not found.")
        return

    bucket = Buckets.objects.create(
        bucket_name=bucket_name,
        datastore_id=datastore,
        owner_id=DEFAULT_OWNER_ID, 
        accessed_at=datetime.datetime.now()
    )
    print(f"Bucket '{bucket_name}' created with ID {bucket.bucket_id}")


def list_buckets(datastore_name):
    buckets = Buckets.objects.filter(datastore_id__datastore_name=datastore_name)

    if not buckets:
        print("No buckets found for this datastore.")
    for b in buckets:
        print(f"{b.bucket_id} | {b.bucket_name} | {b.created_at}")


def delete_bucket(bucket_name, datastore_name):
    buckets = Buckets.objects.filter(bucket_name=bucket_name, datastore_id__datastore_name=datastore_name)
    if not buckets:
        print(f"No bucket found with name '{bucket_name}' in the given datastore.")
    elif buckets.count() == 1:
        buckets.first().delete()
        print(f"Bucket '{bucket_name}' deleted.")
    else:
        print(f"Multiple buckets named '{bucket_name}' found. Use `delete_bucket_by_id` with UUID.")

def delete_bucket_by_id(bucket_id):
    try:
        bucket = Buckets.objects.get(bucket_id=bucket_id)
        bucket.delete()
        print(f"Bucket with ID {bucket_id} deleted.")
    except Buckets.DoesNotExist:
        print(f"No bucket found with ID {bucket_id}")


#main
def main():
    parser = argparse.ArgumentParser(description = "Manage Datastores")
    subparsers = parser.add_subparsers(dest = "command")
    
    #adds of a new datastore 
    parser_add = subparsers.add_parser("add-datastore", help="Create a new datastore")
    parser_add.add_argument("datastore_name", type=str, help="Name of the datastore")
    parser_add.add_argument("--instance_id", type=str, required=False, help="Optional instance UUID of the datastore")
    parser_add.add_argument("--public", action="store_true", help="Make the datastore public (default is private)")
   
    #deletd datastore
    parser_delete_name = subparsers.add_parser("delete-datastore", help="Delete a datastore by name")
    parser_delete_name.add_argument("datastore_name", type=str, help="Name of the datastore")

    #delete datastore suing the uuid
    parser_delete_id = subparsers.add_parser("delete-datastore-by-id", help="Delete a datastore by UUID")
    parser_delete_id.add_argument("datastore_id", type=str, help="UUID of the datastore")
    

    #lists datastore s
    parser_list = subparsers.add_parser("list-datastores", help="List all datastores for a user")
    parser_list.add_argument("--user_id", type=int, default=DEFAULT_OWNER_ID, help="Owner id is default")
    
    #add a bucket
    parser_name = subparsers.add_parser('add-bucket', help='Create bucket using datastore name')
    parser_name.add_argument('bucket_name', help='Bucket name')
    parser_name.add_argument('datastore_name', help='Datastore name')
    parser_name.add_argument('--owner_id', type=int, default=DEFAULT_OWNER_ID, help='Owner ID (default)')
    
    #add bucket by datastore id
    parser_id = subparsers.add_parser('add-bucket-by-id', help='Create bucket using datastore ID')
    parser_id.add_argument('bucket_name', help='Bucket name')
    parser_id.add_argument('datastore_id', help='UUID of datastore')
    parser_id.add_argument('--owner_id', type=int, default=DEFAULT_OWNER_ID, help='Owner ID (default)')
    print("\n")
    
    parser_list_buckets = subparsers.add_parser("list-buckets",help="List all buckets for a given datastore name")
    parser_list_buckets.add_argument("datastore_name", help="The name of the datastore to list buckets for")
    
    #delete te bucket by the name
    parser_delete_bucket = subparsers.add_parser("delete-bucket", help="Delete a bucket by its name and datastore ID")
    parser_delete_bucket.add_argument("bucket_name",help="The name of the bucket to delete")
    parser_delete_bucket.add_argument("datastore_name",help="The name of the datastore that contains the bucket")

    # Delete Bucket by ID
    parser_delete_bucket_by_id = subparsers.add_parser("delete-bucket-by-id",help="Delete a bucket by its ID")
    parser_delete_bucket_by_id.add_argument("bucket_id", help="The ID of the bucket to delete")

    args = parser.parse_args()
    #determines whether the person is trying to delete or add a datastore
    if args.command == "add-datastore":
        add_datastore(args.datastore_name, args.instance_id)
    elif args.command == "delete-datastore":
        delete_datastore(args.datastore_name)
    elif args.command == "delete-datastore-by-id":
        delete_datastore_by_id(args.datastore_id)
    elif args.command == "list-datastores":
        list_datastores(args.user_id)
    elif args.command == 'add-bucket':
        add_bucket(args.bucket_name, args.datastore_name, args.owner_id)
    elif args.command == 'add-bucket-by-id': #by the datastore id
        add_bucket_by_id( args.bucket_name, args.datastore_id, args.owner_id)
    elif args.command == "delete-bucket":
        delete_bucket(args.bucket_name, args.datastore_name)
    elif args.command == "delete-bucket-by-id": #the bucket id 
        delete_bucket_by_id(args.bucket_id)
    elif args.command == "list-buckets":
        list_buckets(args.datastore_name)
    else:
        parser.print_help()
    print("\n")
if __name__ == "__main__":
    main()