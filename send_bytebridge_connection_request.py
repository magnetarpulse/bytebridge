import requests
import os
import json

def main():
    print("\n🔗 ByteBridge Registration to Neurocontroller (Using Token)")
    print("-----------------------------------------------------------")

    # Input from user
    neuro_ip = input("Enter Neurocontroller IP (e.g., 127.0.0.1): ").strip()
    neuro_port = input("Enter Neurocontroller Port (e.g., 8000): ").strip()
    token = input("Paste your access token (JWT from Neurocontroller): ").strip()
    exposed_path = input("Enter full folder path to expose (e.g., C:/xyz/abc/images): ").strip()
    ip_address = input("Enter your machine's IP address (e.g., 192.168.1.xxx): ").strip()
    port = input("Enter ByteBridge port (e.g., 8001): ").strip()

    # Get user_id from token payload (optional, or send token only)
    print("\nSending registration request...")

    # Target URL (should match `/api/register_bytebridge/`)
    url = f"http://{neuro_ip}:{neuro_port}/api/register_bytebridge/"

    # Prepare payload
    payload = {
        "owner_id": 1,  # TEMP: This should be extracted from token ideally, or verified on server
        "ip_address": ip_address,
        "port": port,
        "exposed_path": exposed_path
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }

    try:
        response = requests.post(url, data=json.dumps(payload), headers=headers)
        
        data = response.json()
        access_key = data.get("access_key")
        print("Access Key:", access_key)
        
        # Save it locally
        with open("access_key.txt", "w") as f:
            f.write(access_key)

        if response.status_code == 201:
            print("ByteBridge registered successfully.")
        elif response.status_code == 200:
            print("ℹByteBridge already registered or updated.")
        else:
            print(f"Failed to register. Status: {response.status_code}, Message: {response.text}")
    except Exception as e:
        print(f"Error while connecting: {str(e)}")

if __name__ == "__main__":
    main()
