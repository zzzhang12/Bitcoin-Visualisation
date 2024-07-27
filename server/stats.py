import numpy as np
import websocket
import json
import threading

BITCOIN_WS_URL = "wss://ws.blockchain.info/inv"

transaction_values = []


def on_message(ws, message):
    global transaction_values
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
        
        for currOutput in outputs:
            addr = currOutput['addr']
            if addr:
                size = currOutput['value']
                transaction_values.append(size)
    
    if len(transaction_values) >= 10000:
        ws.close()


def on_error(ws, error):
    print(f"WebSocket error: {error}")


def on_close(ws, close_status_code, close_msg):
    global polling_ref
    print(f"WebSocket closed with status: {close_status_code} and message: {close_msg}")


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


if __name__ == "__main__":
    start_ws()
    while len(transaction_values) < 10000:
        continue
    
    MEAN = np.mean(transaction_values)
    STD_DEV = np.std(transaction_values)
    
    print(f"Mean: {MEAN}, Standard Deviation: {STD_DEV}")