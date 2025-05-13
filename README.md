# ByteBridge
**Jarvis College of Computing and Digital Media - DePaul University**

Authors and Contributors:
- Alexandru Iulian Orhean (aorhean@depaul.edu)
- Areena Mahek (amahek@depaul.edu)
- Rushikesh Rajendra Suryawanshi (rsuryawa@depaul.edu)
- Ankita Kiran Kshirsagar (akshirsa@depaul.edu)
- Marija Stojanoska (mstojan1@depaul.edu)

Scalable Data Management Service for the Neurobazaar Platform.

## Requirements and Setup

```
sudo apt update
sudo apt upgrade
sudo apt install python3.11 python3.11-venv libpython3.11-dev build-essential
```
This software has been developed and tested using Python 3.13 on Ubuntu 24.04 LTS Server Edition.

In terms of enviroment setup, you will need to create a new Python 3.13 Virtual Enviroment and then install the Django dependencies.
Here is a list of commands that you can use on a machine using Ubuntu to set up the enviroment and install the dependencies:
```
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

```

## Running the Program

If you are running the program for the first time, you will need to migrate the Django database:
```
python manage.py makemigrations
python manage.py migrate
```

To start the ByteBridge program run:
```
python manage.py runserver 9000
```
