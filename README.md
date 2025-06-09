
# ByteBridge  
**Jarvis College of Computing and Digital Media – DePaul University**

**Scalable Data Management Service for the Neurobazaar Platform**

---

### Authors and Contributors:
- **Alexandru Iulian Orhean** – aorhean@depaul.edu  
- **Areena Mahek** – amahek@depaul.edu  
- **Rushikesh Rajendra Suryawanshi** – rsuryawa@depaul.edu  
- **Ankita Kiran Kshirsagar** – akshirsa@depaul.edu  
- **Marija Stojanoska** – mstojan1@depaul.edu  

---

## Overview

**ByteBridge** is a secure, modular bridge that allows users to expose local datasets (e.g., image folders) from personal machines to the Neurocontroller backend of the Neurobazaar platform. It avoids large uploads by enabling dynamic folder registration and secure remote access via REST APIs.

---

## Requirements and Setup

### Prerequisites

- Python 3.13  
- Operating System: Tested on **Ubuntu 24.04 LTS** and **Windows 10/11**  
- Internet access to connect with the Neurocontroller instance  
- Access to a registered account on Neurocontroller to obtain a valid token

---

### Setup Instructions (Ubuntu / Linux)

```bash
# Clone the ByteBridge Repository
git clone https://github.com/your-org/bytebridge.git
cd bytebridge

# Create virtual environment
python3.13 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

## Database Initialization (Only First Time)

```bash
python manage.py makemigrations
python manage.py migrate
```

---

## Running the ByteBridge Server

This launches a Django server that exposes a local folder (such as `images/`) via REST APIs to authorized Neurocontroller users.

```bash
python manage.py runserver 0.0.0.0:8001
```

This will expose ByteBridge APIs at:
```
http://<your-ip-address>:8001
```

**Make sure to allow this port in your firewall/router if accessing remotely.**

---

## Registering ByteBridge with Neurocontroller

Use the provided script to securely register your ByteBridge instance to the Neurocontroller using your **JWT token**:

```bash
python send_bytebridge_connection_request.py
```

You will be prompted to enter:
1. Neurocontroller IP and Port  
2. Your JWT Token from Neurocontroller  
3. The full folder path to expose (e.g., `C:/Users/You/Desktop/images`)  
4. Your local machine’s IP address  
5. ByteBridge Port (default: 8001)

---

## API Endpoints (Exposed by ByteBridge)

| Method | Endpoint                   | Description                            |
|--------|----------------------------|----------------------------------------|
| GET    | `/list_files/`             | Lists all files in the shared folder   |
| GET    | `/fetch_file/?access_key=...&name=filename.jpg` | Serves a file securely if access key is valid |

---

## Testing Integration

### From Another Machine or Neurocontroller

To test access:

```python
import requests

access_key = "your_access_key_from_nc"
file_name = "example.jpg"
ip = "192.168.1.106"  # ByteBridge machine IP

url = f"http://{ip}:8001/fetch_file/?access_key={access_key}&name={file_name}"
response = requests.get(url)

if response.status_code == 200:
    with open("downloaded.jpg", "wb") as f:
        f.write(response.content)
    print("Image downloaded successfully.")
else:
    print("Error:", response.status_code, response.text)
```

---

## Security Measures

- All requests to ByteBridge’s exposed files require an `access_key` generated and verified by Neurocontroller.
- Registration requires a **JWT token** to authenticate the user.
- Only authorized users can request access based on centralized permission rules.

---

## Folder Structure

```
bytebridge/
├── bb_app/
│   ├── views.py              # List and serve files
│   ├── urls.py               # Maps REST endpoints
│   └── ...
├── send_bytebridge_connection_request.py  # Registers instance with Neurocontroller
├── manage.py
├── requirements.txt
└── ...
```

---

## Example Folder for Sharing

Create a sample folder with images (e.g., `images/`) and place files like:

```
images/
├── macbook_m2.jpg
├── samsung_tv.jpg
└── whirlpool.jpg
```

Use the full path when prompted during registration:
```
C:/Users/YourName/Desktop/images
```

---

## Troubleshooting

| Issue                                        | Solution                                       |
|---------------------------------------------|------------------------------------------------|
| `403 Forbidden` during file fetch           | Make sure access_key is valid and not expired |
| `404 Not Found`                             | Check if file name is spelled correctly        |
| `Token not valid` during registration       | Regenerate a valid JWT from Neurocontroller   |
| `Failed to establish new connection`        | Ensure ByteBridge is running on correct IP:PORT |

---

## Next Steps (Planned Enhancements)

- File previews (thumbnails)
- Directory-level browsing
- Revocable tokens
- Multi-folder support per ByteBridge

---

## Why ByteBridge?

ByteBridge removes the need for uploading bulky datasets to the cloud and allows **on-demand, secure access** from any authorized machine, streamlining the entire data pipeline in Neurobazaar.
