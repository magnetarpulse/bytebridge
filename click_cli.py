import argparse
import os
import uuid
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bytebridge.settings')
django.setup()

from bb_home.models import UserDatastore, UploadedFileModel

def add_datastore(datastore_id, password, instance_id = None):
    from bb_home.models import UserDatastore
    
    try:
        datastore_uuid = uuid.UUID(datastore_id)
        
    except ValueError:
        print(f"Datastore ID {datastore_id} is not a valid UUID")
        return
    
    datastore, created = UserDatastore.objects.get_or_create(
        datastore_id = datastore_id,
        defaults = {'password': password, 'instance_id': instance_id,})
    
    if created:
        print(f"Datastore {datastore_id} created successfully")
    else:
        print(f"Datastore {datastore_id} already exists")
        
def delete_datastore(datastore_id):
    try:
        datastore = UserDatastore.objects.get(datastore_id = datastore_id)
        datastore.delete()
        print(f"Datastore {datastore_id} deleted successfully")
    except UserDatastore.DoesNotExist:
        print(f"Datastore {datastore_id} does not exist")
        
def list_datastores():
    datastores = UserDatastore.objects.all()
    for datastore in datastores:
        print(f"{datastore.datastore_id} - {datastore.description}")

#def add_file(datastore_name, user_id, file_path, file_type, privacy):
def main():
    parser = argparse.ArgumentParser(description = "Manage Datastores")
    subparsers = parser.add_subparsers(dest = "command")
    #for the adding of a new datastore 
    parser_add = subparsers.add_parser("add-datastore", help = "Unique id a new datastore")  
    parser_add.add_argument("datastore_id", type = str, help = "Name of the datastore")     
    parser_add.add_argument("password", type = str, help = "Password of the datastore")
    parser_add.add_argument("--instance_id", type = str, required= False, help = "Optional instance IF of the datastore")
    #for deleting a datatsore using the datastore_id
    parser_delete = subparsers.add_parser("delete-datastore", help = "Delete a datastore")
    parser_delete.add_argument("name", type = str, help = "Name of the datastore")
    args = parser.parse_args()
    #determines whether the person is trying to delete or add a datastore
    if args.command == "add-datastore":
        add_datastore(args.datastore_id, args.password, args.instance_id)
    elif args.command == "delete-datastore":
        delete_datastore(args.name)
    else:
        parser.print_help()
        
if __name__ == "__main__":
    main()