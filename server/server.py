from flask import Flask, jsonify, send_from_directory, render_template
import json
import networkx as nx
from fa2_modified import ForceAtlas2
import websocket
import threading
import traceback
from flask_socketio import SocketIO, emit
import time
import random 
import math
import requests

app = Flask(__name__, static_folder='../client/static', template_folder='../client/templates')
socketio = SocketIO(app, cors_allowed_origins="*")

# WebSocket to receive Bitcoin transactions
BITCOIN_WS_URL = "wss://ws.blockchain.info/inv"

queue = []
MAX_SIZE = 100
nodes = []
edges = []
node_ids = set()
clients = set()
broadcast_interval = 2  # Frequency in seconds to broadcast data to clients
nx_graph = nx.Graph()  # Global NetworkX graph instance
address_cache = {}
node_positions = {}
queue_lock = threading.Lock()

file_index = 0

json_files = [
    '1.json',
    '2.json',
    '3.json',
    # '4.json',
    # '5.json',
    # '6.json',
    # '7.json',
    # '8.json',
    # '9.json',
    # '10.json'
]

NUM_ROWS = 1
NUM_COLS = 2
CLIENT_WIDTH = 853
CLIENT_HEIGHT = 982

# # Calculate boundary lines based on the number of clients and their sizes
# HORIZONTAL_BOUNDARIES = [i * CLIENT_HEIGHT for i in range(NUM_COLS)] 
# VERTICAL_BOUNDARIES = [i * CLIENT_WIDTH for i in range(NUM_ROWS)]

# HORIZONTAL_BOUNDARIES = [(i * CLIENT_HEIGHT) for i in range(-NUM_COLS//2, NUM_COLS//2 + 1) if i != 0]
# VERTICAL_BOUNDARIES = [(i * CLIENT_WIDTH) for i in range(-NUM_ROWS//2, NUM_ROWS//2 + 1) if i != 0]

HORIZONTAL_BOUNDARIES = [] 
VERTICAL_BOUNDARIES = [853]

# # Dummy nodes and edges for testing
# test_nodes = [
#      {"id": "n1", "x": 100, "y": 100, "color": "#ffffff", "type": "tx"},
#     {"id": "n2", "x": 800, "y": 100, "color": "#FF9933", "type": "input"},
#     {"id": "n3", "x": 900, "y": 100, "color": "#003399", "type": "output"},
#     {"id": "n4", "x": 1000, "y": 100, "color": "#ffffff", "type": "tx"}
# ]

# test_edges = [
#     {"source": "n1", "target": "n2", "type": "out_link"},  
#     {"source": "n3", "target": "n4", "type": "out_link"},  
#     {"source": "n1", "target": "n3", "type": "out_link"}, 
#     {"source": "n2", "target": "n4", "type": "out_link"}  
# ]

# # Add dummy positions to nodes
# positions = {node['id']: (node['x'], node['y']) for node in test_nodes}

# Global variables
numNodes = 0
txTotalVal = 0
txMaxVal = 0
txTotalFee = 0
txMaxFee = 0
txTotalSize = 0
txMaxSize = 0

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

# def start_polling():
#     global polling_ref
#     if polling_ref is not None:
#         polling_ref.cancel()
#     polling_ref = None

#     def poll():
#         print ("inside poll()")
#         if len(queue) == 0:
#             return
#         message = shift()
#         print ("message: ", message)
#         if message is None:
#             return
#         process_transaction([message])

#     polling_ref = threading.Timer(0.5, poll)
#     polling_ref.start()


def start_polling():
    global polling_ref
    
    def poll():
        while True:
            if len(queue) == 0:
                time.sleep(0.5)
                continue
            message = shift()
            if message is None:
                continue
            print("message: ", message)
            process_transaction([message])
            time.sleep(0.5)  # Polling interval

    if polling_ref is not None:
        polling_ref.cancel()
    
    polling_ref = threading.Thread(target=poll)
    polling_ref.daemon = True  # exits when the main program exits
    polling_ref.start()


def on_message(ws, message):
    # print("received websocket messages")
    data = json.loads(message)
    push(data)
    # queue.append(data)
    # if len(queue) < MAX_SIZE:
    #     queue.append(data)
    # else:
    #     queue.pop(0)
    #     queue.append(data)

def on_error(ws, error):
    print(f"WebSocket error: {error}")


def on_close(ws):
    print("### closed ###")


def on_open(ws):
    def run(*args):
        print("Connected to external Bitcoin WebSocket service")
        ws.send(json.dumps({"op": "unconfirmed_sub"}))
        print("subscribed to unconfirmed transactions")
        # ws.send(json.dumps({"op": "blocks_sub"}))
        # print("subscribed to new block notifications")
        start_polling()

    threading.Thread(target=run).start()


def start_ws():
    ws = websocket.WebSocketApp(BITCOIN_WS_URL,
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.on_open = on_open
    # websocket.enableTrace(True)
    print("Starting WebSocket connection to:", BITCOIN_WS_URL) 
    ws.run_forever()



def process_transaction(transactions):
    print ("---------------------------")
    # print("transactions: ", transactions)
    # print("length of transacions: ", len(transactions))

    global nodes, edges, node_ids, nx_graph
    global numNodes, txTotalVal, txMaxVal, txTotalFee, txMaxFee, txTotalSize, txMaxSize

    new_nodes = []
    new_edges = []
    try:
        # print ("number of transactions: ", len(transactions))
        i = 1
        for tx in transactions:
            # if i == 1:
            #     print ("-----------------------------------")
            #     print ("transaction: ", tx)
            txIndex = random.randint(0, 100000000)
            tx['x']['tx_index'] = txIndex
            tx_id = tx['x']['tx_index']

            tx_hash = tx['x']['hash']
            tx_size = tx['x']['size']
            tx_time = tx['x']['time']
            tx_relayer = tx['x']['relayed_by']
            inputs = tx['x']['inputs']
            outputs = tx['x']['out']
            is_coinbase = tx['x'].get('is_coinbase', 0)
            
            orig_tx_color = '#ffffff'
            tx_color = '#ffffff'

            if tx_id not in node_ids:
                node = {
                    'id': tx_id, 
                    'label': tx_hash, 
                    'txHash': tx_hash,
                    'inVals': 0,
                    'outVals': 0,
                    'fee': 0,
                    'txtime': tx_time,
                    'size': 2500000000,
                    'bytesize': tx_size, 
                    'relayer': tx_relayer,
                    'orig_color': orig_tx_color,
                    'color': tx_color,
                    'type': 'tx'
                }
                nodes.append(node)
                new_nodes.append(node)
                node_ids.add(tx_id)
                nx_graph.add_node(tx_id)
                
                node_positions[tx_id] = None # Track initial position

                # print(f"Added transaction node: {tx_id}")
                numNodes += 1


            inVals = 0
            # add orange inputs to graph
            for currInput in inputs:
                currInput['prev_out']['tx_index'] = random.randint(0, 100000000)
                currID = f"{currInput['prev_out']['tx_index']}:{currInput['prev_out']['n']}"
                addr = currInput['prev_out']['addr']
                size = currInput['prev_out']['value']
                orig_in_color = '#FF9933'
                in_color = '#FF9933'
                
                existInput = nx_graph.nodes.get(currID)

                from_text = f" from {currInput['prev_out']['addr']}"

                # if addr is None:
                #     print(f"Skipping input with None address: {currID}")

                if addr:
                    # if input has not already been seen since start of visualisation,
                    # add new node and edge to tx
                    if existInput is None:
                        node = {
                            'id': currID, 
                            'label': f"{currInput['prev_out']['value'] * 1000 / 100000000:.2f}mB{from_text}",
                            'addr': addr, 
                            'size': size,
                            'orig_in_color': orig_in_color,
                            'color': in_color, 
                            'type': 'input'
                        }
                        nodes.append(node)
                        new_nodes.append(node)
                        node_ids.add(currID)
                        nx_graph.add_node(currID)
                        
                        edge = {
                            'id': f"{currID}:{tx_id}",
                            'source': currID, 
                            'target': tx_id, 
                            'orig_in_color': orig_in_color,
                            'color': in_color, 
                            'type': 'in_link'
                            }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(currID, tx_id)

                        node_positions[tx_id] = None # Track initial position

                        numNodes += 1
                        # print(f"Added new input node: {currID}")
                        # print(f"Added input edge: {currID} -> {tx_id}")

                    else:
                        existInput['type'] = 'InOut'

                        edge = {
                            'id': "{currID}:{tx_id}joinToExistIn",
                            'source': currID, 
                            'target': tx_id, 
                            'orig_in_color': orig_in_color,
                            'color': in_color,
                            'type': 'in_link'
                            }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(currID, tx_id)

                        # print('Joined input node:', currID)
                inVals += size

                        
            outVals = 0
            # add blue outputs to graph
            for currOutput in outputs:
                currOutput['tx_index'] = random.randint(0, 100000000)
                currID = f"{currOutput['tx_index']}:{currOutput['n']}"
                size = currOutput['value']
                to_text = f" to {currOutput['addr']}"

                orig_out_color = '#003399'
                out_color = '#003399'

                existOutput = nx_graph.nodes.get(currID)

                # if addr is None:
                #     print(f"Skipping output with None address: {currID}")

                if addr:
                    if existOutput is None:
                        node = {
                            'id': currID, 
                            'label': f"{currOutput['value'] * 1000 / 100000000:.2f}mB{to_text}",
                            'addr': currOutput['addr'], 
                            'tag' :currOutput.get('addr_tag'), 
                            'size': size, 
                            'orig_out_color': orig_out_color,
                            'color': out_color, 
                            'type': 'output'
                        }
                        nodes.append(node)
                        new_nodes.append(node)
                        node_ids.add(currID)
                        nx_graph.add_node(currID)

                        edge = {
                            'id': f"{tx_id}:{currID}",
                            'source': tx_id, 
                            'target': currID,  
                            'orig_out_color': orig_out_color,
                            'color': out_color, 
                            'type': 'out_link'
                        }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(tx_id, currID)

                        node_positions[tx_id] = None # Track initial position

                        numNodes += 1
                        # print(f"Added new output node: {currID}")
                        # print(f"Added output edge: {tx_id} -> {currID}")

                    else:
                        existOutput['type'] = 'InOut'
                        edge = {
                            'id': f"{tx_id}:{currID}joinToExistOut",
                            'source': tx_id, 
                            'target': currID,  
                            'orig_out_color': orig_out_color,
                            'color': out_color, 
                            'type': 'out_link'
                        }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(tx_id, currID)

                        # print('Joined output node:', currID)
                outVals += size

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

            i += 1
        return new_nodes, new_edges

    except Exception as e:
        print("Error processing transactions:", str(e))
        traceback.print_exc()



def get_address_balances(addresses):
    # url = "https://blockchain.info/multiaddr?active=" + '|'.join(addresses)
    url = f"https://blockchain.info/multiaddr?active={'|'.join(addresses)}&n=3"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        balances = {addr['address']: addr['final_balance'] / 1e8 for addr in data['addresses']}  # Convert from satoshis to BTC
        return balances
    else:
        print("Error fetching balances:", response.status_code)
        return {}


def update_cache(address, transaction_value):
    if address in address_cache:
        address_cache[address] += transaction_value
    else:
        address_cache[address] = transaction_value


def compute_graph(new_nodes, new_edges):
    global nx_graph, node_positions

    try:
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
        # print (("----------------------"))
        # print ("positions: ", positions)

        # changed_nodes = []
        
        # print("---------------------------------")
        # print ("length of positions: ", len(positions))
        # for node in nodes:
        #     if node['id'] in positions:
        #         new_pos = positions[node['id']]
        #         prev_pos = node_positions.get(node['id'])

        #         if prev_pos is None or new_pos != prev_pos:
        #             changed_nodes.append({
        #                 'id': node['id'],
        #                 'x': new_pos[0],
        #                 'y': new_pos[1],
        #                 'color': node['color'],
        #                 'type': node['type']
        #             })
        #             node_positions[node['id']] = new_pos

        # print ("length of changed_nodes: ", len(changed_nodes))
        # graph_data = {
        # 'nodes': changed_nodes,
        # 'edges': [{'source': edge['source'], 'target': edge['target'], 'type': edge['type']} for edge in new_edges]
        # }
        all_nodes_set = set(node['id'] for node in new_nodes)

        for edge in new_edges:
            all_nodes_set.add(edge['source'])
            all_nodes_set.add(edge['target'])

        all_nodes = [node for node in nodes if node['id'] in all_nodes_set]

         # list of addresses needing balance queries
        addresses_to_query = []

        # Check each node address
        for node in all_nodes:
            if (node['type'] != "tx"):
                address = node['addr']
                # If it's not in cache, needs querying
                if address and address not in address_cache:
                    addresses_to_query.append(address)
                    # If already in cache, update cached value
                    transaction_value = node['size']
                    update_cache(address, transaction_value)

        # If there are addresses to query, fetch their balances and update cache
        if addresses_to_query:
            new_balances = get_address_balances(addresses_to_query)
            address_cache.update(new_balances)

        # print(f"All nodes to be processed in all_nodes_set: {all_nodes_set}")
        # print("--------------------------------------")
        # print(f"Nodes found in positions: {set(positions.keys())}")
        # print(f"All nodes to be processed in all_nodes: {all_nodes}")

        # for node in all_nodes:
        #     if node['id'] not in positions:
        #         print(f"Node not found in positions: {node['id']}")

        # new_edges_split = []
        # for edge in new_edges:
        #     source_pos = positions[edge['source']]
        #     target_pos = positions[edge['target']]

        #     # Handle Spanning Edges
        #     if is_different_client(source_pos, target_pos):
        #         intersections = []

        #         # Calculate intersections with vertical boundaries
        #         for boundary in VERTICAL_BOUNDARIES:
        #             if min(source_pos[0], target_pos[0]) < boundary < max(source_pos[0], target_pos[0]):
        #                 intersection = compute_intersection(source_pos, target_pos, boundary, True)
        #                 if intersection:
        #                     intersections.append(intersection)

        #         # Calculate intersections with horizontal boundaries
        #         for boundary in HORIZONTAL_BOUNDARIES:
        #             if min(source_pos[1], target_pos[1]) < boundary < max(source_pos[1], target_pos[1]):
        #                 intersection = compute_intersection(source_pos, target_pos, boundary, False)
        #                 if intersection:
        #                     intersections.append(intersection)

        #         print ("intersections: ", intersections)
        #         # Sort intersections by their distance from the source node
        #         intersections.sort(key=lambda p: ((p[0] - source_pos[0])**2 + (p[1] - source_pos[1])**2)**0.5)

        #         last_node_id = edge['source']

        #         for i, intersection in enumerate(intersections):
        #             intersection_id = f"intersection_{edge['source']}_{edge['target']}_{i}"
        #             positions[intersection_id] = intersection

        #             new_edges_split.append({'source': last_node_id, 'target': intersection_id, 'type': edge['type']})
        #             # all_nodes.append({'id': intersection_id, 'x': intersection[0], 'y': intersection[1], 'color': '#000000', 'type': 'intersection'})

        #             last_node_id = intersection_id

        #         new_edges_split.append({'source': last_node_id, 'target': edge['target'], 'type': edge['type']})
        #     else:
        #         new_edges_split.append(edge)

        # graph_data = {
        #     'nodes': [{'id': node['id'], 'x': positions[node['id']][0], 'y': positions[node['id']][1], 'color': node['color'], 'type': node['type']} for node in new_nodes if node['id'] in positions],
        #     'edges': [{'source': edge['source'], 'target': edge['target'], 'type': edge['type']} for edge in new_edges_split]
        # }

        # print(f"Final graph data: {graph_data}")

        # graph_data = {
        #     'nodes': [{'id': node['id'], 'x': positions[node['id']][0], 'y': positions[node['id']][1],  'color': node['color'], 'type': node['type'], 'size': node['size']} for node in all_nodes if node['id'] in positions],
        #     'edges': [{'source': edge['source'], 'target': edge['target'], 'type': edge['type']} for edge in new_edges]
        # }

        graph_data = {
            'nodes': [{'id': node['id'], 
                       'x': positions[node['id']][0], 
                       'y': positions[node['id']][1], 
                       'color': node['color'], 
                       'type': node['type'], 
                       'size': node['size'],
                       'balance': address_cache.get(node['addr'], 0) if node['type'] != 'tx' else None
                     } for node in all_nodes if node['id'] in positions],
            'edges': [{'source': edge['source'], 'target': edge['target'], 'type': edge['type']} for edge in new_edges]
        }

        return graph_data

    except Exception as e:
        print("Error rendering graph:", str(e))
        traceback.print_exc()
        return {'nodes': [], 'edges': []}


def is_different_client(p1, p2):
            x1, y1 = p1
            x2, y2 = p2
            return (x1 // CLIENT_WIDTH) != (x2 // CLIENT_WIDTH) or (y1 // CLIENT_HEIGHT != y2 // CLIENT_HEIGHT)


def compute_intersection(p1, p2, boundary, is_vertical):
            x1, y1 = p1
            x2, y2 = p2
            if is_vertical:
                if x1 == x2:
                    return None  # Avoid division by zero
                y = y1 + (boundary - x1) * (y2 - y1) / (x2 - x1)
                return (boundary, y)
            else:
                if y1 == y2:
                    return None  # Avoid division by zero
                x = x1 + (boundary - y1) * (x2 - x1) / (y2 - y1)
                return (x, boundary)


@app.route('/static/<path:path>', methods=['GET'])
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


@app.route('/', methods=['GET'])
def index():
    return render_template('index.html')


@socketio.on('connect')
def handle_connect():
    print('Client connected') 
    emit('connection_response', {'data': 'Connected to server'})
    # global file_index
    # file_index = 0 
    # socketio.start_background_task(send_json_files)


@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')


def periodic_broadcast():
    global nodes, edges
    while True:
        if not queue:
            continue
        transactions = queue[:]
        # new_nodes, new_edges = process_transaction(transactions)
        # graph_data = compute_graph(new_nodes, new_edges)
        graph_data = compute_graph(nodes, edges)
        socketio.emit('graph_data', graph_data)
        print("emitted to client")

         # Save graph_data to a local JSON file with sequential names
        # filename = f"{counter}.json"
        # with open(filename, 'w') as f:
        #     json.dump(graph_data, f, indent=4)
        # counter += 1

        time.sleep(broadcast_interval)



def send_json_files():
    global file_index, json_files
    while file_index < len(json_files):
        with open(json_files[file_index]) as f:
            graph_data = json.load(f)
            socketio.emit('graph_data', graph_data)
            print("emitted to client")
        file_index += 1
        time.sleep(broadcast_interval)  # Adjust the delay as needed

# # Test the function
# compute_graph(test_nodes, test_edges)

if __name__ == '__main__':
    print("Starting Flask server on 0.0.0.0:3000")
    threading.Thread(target=start_ws).start()
    # threading.Thread(target=start_polling).start()
    # threading.Thread(target=periodic_broadcast).start()
    # threading.Thread(target=send_json_files).start()
    socketio.run(app, host='0.0.0.0', port=3000)