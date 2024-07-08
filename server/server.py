from flask import Flask, jsonify
import json
import networkx as nx
from fa2_modified import ForceAtlas2
import websocket
# import websocket_server
import threading
from dotenv import load_dotenv
import traceback
from flask_socketio import SocketIO, send, emit

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# WebSocket to receive Bitcoin transactions
BITCOIN_WS_URL = "wss://ws.blockchain.info/inv"

queue = []
MAX_SIZE = 100
nodes = []
edges = []
node_ids = set()
clients = set()

def push(msg):
    global queue
    if len(queue) < MAX_SIZE:
        queue.append(msg)
    else:
        idx = next((i for i, item in enumerate(queue) if item.get('op') == 'utx'), -1)
        if idx < 0:
            if msg.get('op') == 'utx':
                return
            queue.append(msg)
        else:
            queue.pop(idx)
            queue.append(msg)

def shift():
    if queue:
        return queue.pop(0)
    return None

polling_ref = None

def start_polling():
    global polling_ref
    if polling_ref is not None:
        polling_ref.cancel()
    polling_ref = threading.Timer(0.5, poll)
    polling_ref.start()

def poll():
    if len(queue) == 0:
        return
    message = shift()
    if message is not None:
        process_transaction([message])
    start_polling()

def on_message(ws, message):
    data = json.loads(message)
    if len(queue) < MAX_SIZE:
        queue.append(data)
    else:
        queue.pop(0)
        queue.append(data)

def on_error(ws, error):
    print(f"WebSocket error: {error}")

def on_close(ws):
    print("### closed ###")

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
    print("Starting WebSocket connection to:", BITCOIN_WS_URL) 
    ws.run_forever()


def process_transaction(transactions):
    global nodes, edges, node_ids
    numNodes = 0
    numTx = 0
    numIn = 0
    numOut = 0
    txTotalVal = 0
    txMaxVal = 0
    txTotalFee = 0
    txMaxFee = 0
    txTotalSize = 0
    txMaxSize = 0
    try:
        for tx in transactions:
            tx_id = tx.get('x', {}).get('hash')
            if not tx_id:
                continue
            tx_index = int(tx.get('x', {}).get('tx_index', 0))
            tx_size = tx.get('x', {}).get('size', 0)
            tx_time = tx.get('x', {}).get('time', 0)
            tx_relayer = tx.get('x', {}).get('relayed_by', '')
            is_coinbase = tx.get('x', {}).get('is_coinbase', 0)
            tx_color = '#ffffff'

            if tx_id not in node_ids:
                nodes.append({
                    'node_id': tx_id, 'label': f'Transaction {tx_id}', 'txHash': tx_id,
                    'size': tx_size, 'time': tx_time, 'relayer': tx_relayer, 'color': tx_color,
                    'type': 'tx', 'tx_index': tx_index, 'is_coinbase': is_coinbase
                })
                node_ids.add(tx_id)
                numTx += 1

            inputs = tx.get('x', {}).get('inputs', [])
            outputs = tx.get('x', {}).get('out', [])
            inVals = 0
            outVals = 0

            # Process inputs
            for inp in inputs:
                addr = inp.get('prev_out', {}).get('addr')
                value = inp.get('prev_out', {}).get('value', 0)
                addr_tag = inp.get('prev_out', {}).get('addr_tag', '')

                if addr and addr not in node_ids:
                    nodes.append({
                        'node_id': addr, 'label': addr, 'value': value,
                        'tag': addr_tag, 'color': '#FF9933', 'type': 'input'
                    })
                    node_ids.add(addr)
                    numIn += 1
                if addr:
                    edges.append({'src': addr, 'dst': tx_id, 'value': value, 'type': 'in_link'})
                inVals += value

            # Process outputs
            for out in outputs:
                addr = out.get('addr')
                value = out.get('value', 0)
                addr_tag = out.get('addr_tag', '')
                if addr and addr not in node_ids:
                    nodes.append({
                        'node_id': addr, 'label': addr, 'value': value,
                        'tag': addr_tag, 'color': '#003399', 'type': 'output'
                    })
                    node_ids.add(addr)
                    numOut += 1
                if addr:
                    edges.append({'src': tx_id, 'dst': addr, 'value': value, 'type': 'out_link'})
                outVals += value

            # Update transaction node values
            tx_fee = max(inVals - outVals, 0)
            tx_label = f'{outVals * 1000 / 100000000:.2f}mB + {tx_fee * 1000 / 100000000:.2f}mBFee {tx_id}'
            nodes[-1]['inVals'] = inVals
            nodes[-1]['outVals'] = outVals
            nodes[-1]['fee'] = tx_fee
            nodes[-1]['label'] = tx_label

            txTotalVal += outVals
            txMaxVal = max(txMaxVal, outVals)
            txTotalFee += tx_fee
            txMaxFee = max(txMaxFee, tx_fee)
            txTotalSize += tx_size
            txMaxSize = max(txMaxSize, tx_size)
            numNodes += 1

        graph_data = compute_graph()
        # Save graph_data to a JSON file
        with open('graph_data.json', 'w') as f:
            json.dump(graph_data, f)
        # broadcast_to_clients(graph_data)
        return graph_data

    except Exception as e:
        print("Error processing transactions:", str(e))
        traceback.print_exc()


@app.route('/', methods=['GET'])
def get_graph():
    print("Received request for graph")
    if not queue:
        return jsonify({'nodes': [], 'edges': []})
    transactions = queue[:]
    graph_data = process_transaction(transactions)
    return jsonify(graph_data)


def compute_graph():
    try:
        global nodes, edges

        # Create NetworkX graph
        nx_graph = nx.Graph()
        for node in nodes:
            nx_graph.add_node(node['node_id'])
        for edge in edges:
            nx_graph.add_edge(edge['src'], edge['dst'])

        # Compute layout using ForceAtlas2
        forceatlas2 = ForceAtlas2(
            outboundAttractionDistribution=False,
            linLogMode=False,
            adjustSizes=False,
            edgeWeightInfluence=1.0,
            jitterTolerance=1.0,
            barnesHutOptimize=True,
            barnesHutTheta=1.2,
            multiThreaded=False,
            scalingRatio=2.0,
            strongGravityMode=False,
            gravity=1.0,
            verbose=True
        )
        positions = forceatlas2.forceatlas2_networkx_layout(nx_graph, pos=None, iterations=2000)
        
        graph_data = {
            'nodes': [{'id': node['node_id'], 'x': positions[node['node_id']][0], 'y': positions[node['node_id']][1], 'color': node['color'], 'type': node['type']} for node in nodes if node['node_id'] in positions],
            'edges': [{'source': edge['src'], 'target': edge['dst'], 'type': edge['type']} for edge in edges]
        }

        return graph_data

    except Exception as e:
        print("Error rendering graph:", str(e))
        traceback.print_exc()


@socketio.on('connect')
def handle_connect():
    print("Client connected")
    print("Request Headers:", request.headers)
    print("Request Data:", request.data)

@socketio.on('disconnect')
def handle_disconnect():
    print("Client disconnected")

@socketio.on('message')
def handle_message(message):
    print(f"Received message from client: {message}")


def broadcast_to_clients(data):
    print("Broadcasting data to clients")
    for client in clients:
        try:
            client.send(json.dumps(data))
        except Exception as e:
            print(f"Error broadcasting to client: {e}")


if __name__ == '__main__':
    print("Starting Flask server on 0.0.0.0:3000")
    threading.Thread(target=start_ws).start()
    start_polling()
    socketio.run(app, host='0.0.0.0', port=3000)