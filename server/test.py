import websocket
import json

def on_message(ws, message):
    print("received websocket message")
    data = json.loads(message)
    print(data)

def on_error(ws, error):
    print("WebSocket Error:", error)

def on_close(ws):
    print("WebSocket closed")

def on_open(ws):
    print("Connected to external Bitcoin WebSocket service")
    ws.send(json.dumps({"op": "unconfirmed_sub"}))
    print("subscribed to unconfirmed transactions")

if __name__ == "__main__":
    websocket.enableTrace(True)
    ws = websocket.WebSocketApp("wss://ws.blockchain.info/inv",
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.on_open = on_open
    ws.run_forever()