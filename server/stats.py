"""
####
  Created by zz3823 MSc Computing in Sep2024.
####
"""

import numpy as np
import websocket
import json
import threading
import requests

BITCOIN_WS_URL = "wss://ws.blockchain.info/inv"

transaction_values = []
address_balances = []
address_set = set()
new_addresses = set()

def get_address_balances(addresses):
    url = f"https://blockchain.info/multiaddr?active={'|'.join(addresses)}&n=1"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        balances = [addr['final_balance']for addr in data['addresses']]
        return balances
    else:
        print("Error fetching balances:", response.status_code)
        return {}


def on_message(ws, message):
    global transaction_values, address_balances, address_set, new_addresses
    data = json.loads(message)
    
    if data['op'] == 'utx':
        tx = data['x']
        inputs = tx['inputs']
        outputs = tx['out']

        for currInput in inputs:
            addr = currInput['prev_out']['addr']
            if addr:
                size = currInput['prev_out']['value']
                transaction_values.append(size)
                if addr not in address_set:
                    new_addresses.add(addr)
                    address_set.add(addr)

                    if len(new_addresses) >= 100:
                        balances = get_address_balances(list(new_addresses))
                        new_addresses = set()
                        address_balances.extend(balances)
 
        for currOutput in outputs:
            addr = currOutput['addr']
            if addr:
                size = currOutput['value']
                transaction_values.append(size)
                if addr not in address_set:
                    new_addresses.add(addr)
                    address_set.add(addr)

                if len(new_addresses) >= 100:
                    balances = get_address_balances(list(new_addresses))
                    new_addresses = set()
                    address_balances.extend(balances)
    
    if len(transaction_values) >= 10000:
        balances = get_address_balances(list(new_addresses))
        address_balances.extend(balances)
        ws.close()


def on_error(ws, error):
    print(f"WebSocket error: {error}")


def on_close(ws, close_status_code, close_msg):
    global polling_ref
    print(f"WebSocket closed with status: {close_status_code} and message: {close_msg}")
    calculate_statistics()


def on_open(ws):
    def run(*args):
        print("Connected to external Bitcoin WebSocket service")
        ws.send(json.dumps({"op": "unconfirmed_sub"}))
        print("subscribed to unconfirmed transactions")

    threading.Thread(target=run).start()


def start_ws():
    ws = websocket.WebSocketApp(BITCOIN_WS_URL,
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.on_open = on_open
    ws.run_forever()


def calculate_statistics():
    global transaction_values, address_balances

    # Transaction size statistics
    mean_tx = np.mean(transaction_values)
    std_dev_tx = np.std(transaction_values) 
    p25_tx = np.percentile(transaction_values, 25)
    p75_tx = np.percentile(transaction_values, 75)
    median_tx = np.median(transaction_values)
    iqr_tx = p75_tx - p25_tx

    # Address balance statistics
    mean_balance = np.mean(address_balances)
    std_dev_balance = np.std(address_balances)
    p25_balance = np.percentile(address_balances, 25)
    p75_balance = np.percentile(address_balances, 75)
    median_balance = np.median(address_balances)
    iqr_balance = p75_balance - p25_balance

    print(f"Calculated MEAN: {mean_tx}, STD_DEV: {std_dev_tx}, p25_tx: {p25_tx}, p75_tx: {p75_tx}, median_tx: {median_tx}IQR Tx: {iqr_tx}")
    print(f"Calculated Balance MEAN: {mean_balance}, STD_DEV: {std_dev_balance}, p25_balance: {p25_balance}, p75_balance: {p75_balance}, median_balance: {median_balance}, IQR Balance: {iqr_balance}")
    with open('./server/transaction_stats.json', 'w') as f:
        json.dump({
            'mean_tx': mean_tx, 'std_dev_tx': std_dev_tx, 'p25_tx': p25_tx, 'p75_tx': p75_tx, 'median_tx': median_tx, 'iqr_tx': iqr_tx,
            'mean_balance': mean_balance, 'std_dev_balance': std_dev_balance, 'p25_balance': p25_balance, 'p75_balance': p75_balance, 'median_balance': mean_balance, 'iqr_balance': iqr_balance,
        }, f, indent=4)


if __name__ == "__main__":
    start_ws()