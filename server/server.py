"""
####
  Created by zz3823 MSc Computing in Sep2024.
####
"""

from flask import Flask, jsonify, send_from_directory, render_template, request
import json
import networkx as nx
from fa2_modified import ForceAtlas2
import websocket
import threading
import traceback
from flask_socketio import SocketIO, emit
import time
import random 
import requests
import numpy as np
import os
from dotenv import load_dotenv

                    
app = Flask(__name__, static_folder='../client/static', template_folder='../client/templates')
socketio = SocketIO(app, cors_allowed_origins="*")

# Load environment variables from the .env file
load_dotenv()

SOCKET_IP = os.getenv('IP_ADDRESS')

# WebSocket to receive Bitcoin transactionss
BITCOIN_WS_URL = "wss://ws.blockchain.info/inv"

##################################################
############### Global Variables #################
queue = []
MAX_SIZE = 100 # max queue size
nodes = [] # all nodes
edges = [] # all edges
node_ids = set()   # for tracking nodes
broadcast_interval = 1.8 # Frequency in seconds to broadcast data to clients
scale_factor = 2.0
nx_graph = nx.Graph()  # Global NetworkX graph instance
address_cache = {}  # Cache of addresses balances
current_addresses = {} # Addresses in the current visualisation, resets to empty when server resetes
balance_stats = {}
node_positions = {}
addresses_to_query = [] # Addresses not in cache, thus need API query
address_dict = {} # track addresses and associated nodes
paused = False
msgBuf = []
start_visualization = False # Initialised to false, True when visualisation started by controller
graph_data_accumulated = {
    "nodes": [],
    "edges": [],
    "stats": {},
    "histograms": {},
    "lineGraphs": {}
}
clients_received = 0
clients_connected = 0

# Locks
queue_lock = threading.Lock()
forceatlas2_lock = threading.Lock()
start_lock = threading.Lock()
save_lock = threading.Lock()

# Statistical measures of tx value and balance size. Retrieved from stats.py
mean_tx = 0 # Mean of transaction values
std_dev_tx = 0 # Standard deviation of transaction values
p25_tx = 0 # 25th percentile of transaction values
p75_tx = 0 # 75th percentile of transaction values
iqr_tx = 0 # interquartile range of transaction values
mean_balance = 0 # Mean of address balances
std_dev_balance = 0 # Standard deviation of address balances
p25_balance = 0 # 25th percentile of address balances
p75_balance = 0 # 75th percentile of address balances
iqr_balance = 0 # interquartile range of address balances


# Canvas sizes
NUM_CLIENTS = 16
NUM_GRAPH_CLIENTS = 12
NUM_ROWS = 4
NUM_COLS = 3
CLIENT_WIDTH = 1920
CLIENT_HEIGHT = 1080
HORIZONTAL_BOUNDARIES = [-2160, -1080, 0, 1080, 2160] 
VERTICAL_BOUNDARIES = [-2880, -960, 960, 2880]
   
# Global statistics variables
usd_price = 0
lastRateTx = 0
timeOfLastTx = time.time()
txRate = 0

numTx = 0
numIn = 0
numOut = 0
numNodes = 0

txTotalVal = 0
txMaxVal = 0

txTotalFee = 0
txMaxFee = 0

txTotalSize = 0
txMaxSize = 0

############### End of global variables #############
########################################################


def load_transaction_stats():
    global mean_tx, std_dev_tx, p25_tx, p75_tx, iqr_tx, mean_balance, std_dev_balance, p25_balance, p75_balance, iqr_balance
    with open('./server/transaction_stats.json') as f:
        transaction_stats = json.load(f)
        mean_tx = transaction_stats.get('mean_tx')
        std_dev_tx = transaction_stats.get('std_dev_tx')
        p25_tx = transaction_stats.get('p25_tx')
        p75_tx = transaction_stats.get('p75_tx')
        iqr_tx = transaction_stats.get('iqr_tx')
        mean_balance = transaction_stats.get('mean_balance')
        std_dev_balance = transaction_stats.get('std_dev_balance')
        p25_balance = transaction_stats.get('p25_balance')
        p75_balance = transaction_stats.get('p75_balance')
        iqr_balance = transaction_stats.get('iqr_balance')


def reset_server_state():
    global nodes, edges, node_ids, nx_graph, node_positions
    global numNodes, numTx, numIn, numOut, txTotalVal, txMaxVal, txTotalFee, txTotalSize, txMaxSize, numTx, lastRateTx, timeOfLastTx, txRate, current_addresses, usd_price, clients_connected

    nodes = []
    edges = []
    node_ids = set()
    nx_graph.clear()  
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
    numTx = 0
    lastRateTx = 0
    timeOfLastTx = time.time()
    txRate = 0
    current_addresses = {}
    balance_stats = {}
    usd_price = 0
    clients_connected = 0

    print("Server state has been reset.")


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
stop_event = threading.Event()

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
            process_message([message])
            time.sleep(0.5)  # Polling interval

    if polling_ref is not None:
        polling_ref.cancel()
    
    polling_ref = threading.Thread(target=poll)
    polling_ref.daemon = True  # exits when the main program exits
    polling_ref.start()


def on_message(ws, message):
    data = json.loads(message)
    push(data)


def on_error(ws, error):
    print(f"WebSocket error: {error}")


def on_close(ws):
    global polling_ref
    print("WebSocket closed")
    if polling_ref is not None:
        polling_ref.cancel()


def on_open(ws):
    def run(*args):
        print("Connected to external Bitcoin WebSocket service")
        ws.send(json.dumps({"op": "unconfirmed_sub"}))
        print("subscribed to unconfirmed transactions")
        start_polling()

    threading.Thread(target=run).start()


def start_ws():
    ws = websocket.WebSocketApp(BITCOIN_WS_URL,
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.on_open = on_open
    print("Starting WebSocket connection to:", BITCOIN_WS_URL) 
    ws.run_forever()


def process_message(msg):
    global paused, msgBuf

    if paused:
        msgBuf.append(msg)
    else:
        # print (msg)
        if msg[0]["op"] == "utx":
            process_transaction(msg)
        elif msg[0]["op"] == "block":
            process_block(msg)


def process_transaction(transactions):

    global nodes, edges, node_ids, nx_graph, address_dict, address_cache, current_addresses, balance_stats
    global numNodes, numTx, numIn, numOut, txTotalVal, txMaxVal, txTotalFee, txMaxFee, txTotalSize, txMaxSize, lastRateTx, timeOfLastTx, txRate

    new_nodes = []
    new_edges = []
    try:
        i = 1
        for tx in transactions:
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
                tx_node = {
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
                nodes.append(tx_node)
                new_nodes.append(tx_node)
                node_ids.add(tx_id)
                nx_graph.add_node(tx_id)
                node_positions[tx_id] = (random.uniform(-1, 1), random.uniform(-1, 1))

                # print(f"Added transaction node: {tx_id}")

                # Update Statistics
                numNodes += 1
                numTx += 1
                # print ("Added tx node", numNodes)


            inVals = 0
            # add orange inputs to graph
            for currInput in inputs:
                currInput['prev_out']['tx_index'] = random.randint(0, 100000000)
                currID = f"{currInput['prev_out']['tx_index']}:{currInput['prev_out']['n']}"
                addr = currInput['prev_out']['addr']
                size = currInput['prev_out']['value']
                z_score_tx = calculate_z_score(size, "tx")
                iqr_score_tx = calculate_iqr_score(size, "tx")
                orig_in_color = '#FF9933'
                in_color = '#FF9933'
                
                existInput = nx_graph.nodes.get(currID)

                from_text = f" from {currInput['prev_out']['addr']}"

                if addr:
                    # if input has not already been seen since start of visualisation,
                    # add new node and edge to tx
                    if existInput is None:
                        node = {
                            'id': currID, 
                            'label': f"{currInput['prev_out']['value'] * 1000 / 100000000:.2f}mB{from_text}",
                            'addr': addr, 
                            'size': size,
                            'z_score_tx': z_score_tx,
                            'iqr_score_tx': iqr_score_tx,
                            'z_score_balance': 0, # initialized to 0. will be retrieved in compute_graph()
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
                            'type': 'in_link',
                            'weight': 5,
                            'size': size,
                            'z_score_tx': z_score_tx,
                            'iqr_score_tx': iqr_score_tx
                            }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(currID, tx_id)

                        node_positions[currID] = (random.uniform(-1, 1), random.uniform(-1, 1))

                        # Update statistics
                        numNodes += 1
                        numIn += 1

                        # print ("Added input node", numNodes)
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
                            'type': 'in_link',
                            'weight': 20,
                            'size': size,
                            'z_score_tx': z_score_tx,
                            'iqr_score_tx': iqr_score_tx
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
                z_score_tx = calculate_z_score(size, "tx")
                iqr_score_tx = calculate_iqr_score(size, "tx")
                addr = currOutput['addr']
                to_text = f" to {currOutput['addr']}"

                orig_out_color = '#003399'
                out_color = '#003399'

                existOutput = nx_graph.nodes.get(currID)

                if addr:
                    if existOutput is None:
                        node = {
                            'id': currID, 
                            'label': f"{currOutput['value'] * 1000 / 100000000:.2f}mB{to_text}",
                            'addr': addr, 
                            'tag' :currOutput.get('addr_tag'), 
                            'size': size, 
                            'z_score_tx': z_score_tx,
                            'iqr_score_tx': iqr_score_tx,
                            'z_score_balance': 0, # initialized to 0. will be retrieved in compute_graph()
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
                            'type': 'out_link',
                            'weight': 5,
                            'size': size,
                            'z_score_tx': z_score_tx,
                            'iqr_score_tx': iqr_score_tx,
                        }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(tx_id, currID)

                        node_positions[currID] = (random.uniform(-1, 1), random.uniform(-1, 1))

                        # Update statistics
                        numNodes += 1
                        numOut += 1
                        # print ("Added output node", numNodes)
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
                            'type': 'out_link',
                            'weight': 5,
                            'size': size,
                            'z_score_tx': z_score_tx,
                            'iqr_score_tx': iqr_score_tx,
                        }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(tx_id, currID)

                        # print('Joined output node:', currID)
                    outVals += size

            # Update transaction node values
            tx_fee = max(inVals - outVals, 0)
            tx_label = f'{outVals * 1000 / 100000000:.2f}mB + {tx_fee * 1000 / 100000000:.2f}mBFee {tx_id}'
            tx_node['inVals'] = inVals
            tx_node['outVals'] = outVals
            tx_node['fee'] = tx_fee
            tx_node['label'] = tx_label


            txTotalVal += outVals
            txMaxVal = max(txMaxVal, outVals)
            txTotalFee += tx_fee
            txMaxFee = max(txMaxFee, tx_fee)
            txTotalSize += tx_size
            txMaxSize = max(txMaxSize, tx_size)

            # For every 10 transactions
            if numTx - lastRateTx >= 10:
                # Update txRate
                txRate = 10 / ((time.time() - timeOfLastTx) / 1000)
                timeOfLastTx = time.time()
                lastRateTx = numTx

                # Emit txRate to update tx rate line graph
                tx_rate = {
                    'txRate': round(txRate, 2)
                }

                socketio.emit('tx_rate_stats', tx_rate)

                if current_addresses:
                    # Update statistics of address balances
                    update_address_balance_stats()

            # After updating the variables, emit the updated statistics to the clients 
            statistics = {
                'numNodes': numNodes,
                'numTx': numTx,
                'numIn': numIn,
                'numOut': numOut,
                'txTotalVal': txTotalVal,
                'txMaxVal': txMaxVal,
                'txTotalFee': txTotalFee,
                'txMaxFee': txMaxFee,
                'txTotalSize': txTotalSize,
                'txMaxSize': txMaxSize,
                'txRate': round(txRate, 2)
            }
            statistics.update(balance_stats)

            socketio.emit('update_stats', statistics)
             
            # Emit updated statistics to clients rendering histograms and line graphs
            graph_stats = {
                'txVal': outVals * 1000 / 100000000,
                'txSize': tx_size,
                'txAvgFee': txTotalFee / numTx * 1000 / 100000000,
            }

            socketio.emit('stats', graph_stats)


        # Get balance of each address
        global addresses_to_query

        for node in new_nodes:
            # only input and output nodes can have addresses
            if (node['type'] != "tx" and node['type'] != "intersection"):
                address = node['addr']
                if address: 
                    # if address is not in cache, append it to the list to be queried using API
                    if address not in address_cache:
                        addresses_to_query.append(address)
                    # if address is already in cache, update the cached value
                    else:
                        transaction_value = node['size']
                        update_cache(address, transaction_value, "cache")
                        update_cache(address, transaction_value, "current")

        if len(addresses_to_query) >= 50:
            new_balances = get_address_balances(addresses_to_query)
            address_cache.update(new_balances)
            current_addresses.update(new_balances)
            addresses_to_query = []

    except Exception as e:
        print("Error processing transactions:", str(e))
        traceback.print_exc()


def calculate_z_score(value, type):
    global mean_tx, std_dev_tx, mean_balance, std_dev_balance
    if type == "tx":
        return (value - mean_tx) / std_dev_tx
    elif type == "balance":
        return (value - mean_balance) / std_dev_balance


def calculate_iqr_score(value, type):
    global p25_tx, p75_tx, iqr_tx, p25_balance, p75_balance, iqr_balance

    if type == "tx":
        if iqr_tx == 0:  # Avoid division by zero
            return 0

        if value <= p25_tx:
            # Value is below the 25th percentile
            return (value - p25_tx) / iqr_tx
        elif value > p25_tx and value < p75_tx:
            return (value - (p75_tx - p25_tx)) / iqr_tx
        else:
            # Value is above the 75th percentile
            return (value - p75_tx) / iqr_tx

    elif type == "balance":
        if iqr_balance == 0:  # Avoid division by zero
            return 0
        if value <= p25_balance:
            # Value is below the 25th percentile
            return (value - p25_balance) / iqr_balance
        elif value > p25_balance and value < p75_balance:
            return (value - (p75_balance - p25_balance)) / iqr_balance
        else:
            # Value is above the 75th percentile
            return (value - p75_balance) / iqr_balance


def get_address_balances(addresses):
    url = f"https://blockchain.info/multiaddr?active={'|'.join(addresses)}&n=0"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        balances = {addr['address']: addr['final_balance'] for addr in data['addresses']}  # Convert from satoshis to BTC
        return balances
    else:
        print("Error fetching balances:", response.status_code)
        return {}


def update_cache(address, transaction_value, type):
    global address_cache, current_addresses
    if type == "cache":
        if address in address_cache:
            address_cache[address] += transaction_value
        else:
            address_cache[address] = transaction_value
    elif type == "current":
        if address in current_addresses:
            current_addresses[address] += transaction_value
        else:
            current_addresses[address] = transaction_value


def update_address_balance_stats():
    global current_addresses, balance_stats

    # Get all balance values from the dictionary
    balances = np.array(list(current_addresses.values()))
    
    # Calculate the required statistics
    median_balance = np.median(balances)
    percentile_25th = np.percentile(balances, 25)
    percentile_75th = np.percentile(balances, 75)
    iqr = percentile_75th - percentile_25th
    max_balance = np.max(balances)

    # Update balance stats
    balance_stats["balanceMed"] = float(median_balance)
    balance_stats["balanceIQR"] = float(iqr)
    balance_stats["balanceMax"] = float(max_balance)
   

def compute_graph(new_nodes, new_edges):
    global nx_graph, node_positions, scale_factor

    total_iterations = 80

    try:
         # Initialize node_positions if it's not already done, or update with any new nodes
        if node_positions is None:
            node_positions = {node: (random.uniform(-1, 1), random.uniform(-1, 1)) for node in nx_graph.nodes()}
        else:
            # Ensure all nodes in the graph have a valid entry in node_positions
            # for node in nx_graph.nodes():
            for node in new_nodes:
                node_id = node['id']
                if node_id not in node_positions or node_positions[node_id] == (0.0, 0.0):
                    node_positions[node_id] = (random.uniform(-1, 1), random.uniform(-1, 1))

        # Initialize ForceAtlas2 with the desired parameters
        forceatlas2 = ForceAtlas2(
            outboundAttractionDistribution=False,
            linLogMode=False,
            adjustSizes=False,
            edgeWeightInfluence=1.0,
            jitterTolerance=0.5,
            barnesHutOptimize=True,
            barnesHutTheta=1.0,
            multiThreaded=False,
            scalingRatio=35.0,
            strongGravityMode=False,
            gravity=20.0,
            verbose=False
        )

        if not nx_graph.nodes or not nx_graph.edges:
            print("Graph is empty, exiting compute_graph function.")
            return

        # Run ForceAtlas2, starting with the current node positions
        positions = forceatlas2.forceatlas2_networkx_layout(nx_graph, pos=node_positions, iterations=total_iterations)

        # Update the global node positions with the new positions calculated by ForceAtlas2
        node_positions.update(positions)

        scaled_positions = node_positions.copy()
        for node_id in scaled_positions:
            x, y = scaled_positions[node_id]
            scaled_positions[node_id] = (x * scale_factor, y * scale_factor)
        
        # After all iterations, create and emit the final graph data
        final_graph_data = create_graph_data(new_nodes, new_edges, scaled_positions)

        socketio.emit('graph_data', final_graph_data)

        return final_graph_data

    except Exception as e:
        print("Error rendering graph:", str(e))
        traceback.print_exc()
        return {'nodes': [], 'edges': []}
   

def create_graph_data(new_nodes, new_edges, positions):
    global scale_factor

    new_edges_split = []
    all_x_values = []
    all_y_values = []
    outside_x_range = 0
    outside_y_range = 0

    for edge in new_edges:
        if edge['source'] in positions and edge['target'] in positions:
            source_pos = positions[edge['source']]
            target_pos = positions[edge['target']]

             # Collecting x and y values
            all_x_values.append(source_pos[0])
            all_x_values.append(target_pos[0])
            all_y_values.append(source_pos[1])
            all_y_values.append(target_pos[1])

            intersections = []

            for boundary in VERTICAL_BOUNDARIES:
                if min(source_pos[0], target_pos[0]) < boundary < max(source_pos[0], target_pos[0]):
                    intersection = compute_intersection(source_pos, target_pos, boundary, True)
                    if intersection:
                        intersections.append(intersection)


            for boundary in HORIZONTAL_BOUNDARIES:
                if min(source_pos[1], target_pos[1]) < boundary < max(source_pos[1], target_pos[1]):
                    intersection = compute_intersection(source_pos, target_pos, boundary, False)
                    if intersection:
                        intersections.append(intersection)


            intersections.sort(key=lambda p: ((p[0] - source_pos[0])**2 + (p[1] - source_pos[1])**2)**0.5)
            last_node_id = edge['source']
            
            
            if intersections:
                for i, intersection in enumerate(intersections):
                    intersection_id = f"intersection_{edge['source']}_{edge['target']}_{i}"
                    positions[intersection_id] = intersection

                    all_x_values.append(intersection[0])
                    all_y_values.append(intersection[1])

                    new_edges_split.append({
                        'source': last_node_id,
                        'target': intersection_id,
                        'type': edge['type'],
                        'color': edge['color'],
                        'size': edge['size'],
                        'z_score_tx': edge['z_score_tx'],
                        'iqr_score_tx': edge['iqr_score_tx']
                    })
                    new_nodes.append({'id': intersection_id, 'x': intersection[0], 'y': intersection[1], 'color': '#000000', 'type': 'intersection'})

                    last_node_id = intersection_id

                new_edges_split.append({
                    'source': last_node_id,
                    'target': edge['target'],
                    'type': edge['type'],
                    'color': edge['color'],
                    'size': edge['size'],
                    'z_score_tx': edge['z_score_tx'],
                    'iqr_score_tx': edge['iqr_score_tx']
                })
            else:
                new_edges_split.append(edge)

    graph_data = {
        'nodes': [{'id': node['id'], 
                   'x': positions[node['id']][0], 
                   'y': positions[node['id']][1], 
                   'color': node['color'], 
                   'type': node['type'], 
                   'size': node['bytesize'] if node['type'] == 'tx' else None,
                   'inVals': node['inVals'] if node['type'] == 'tx' else None,
                   'outVals': node['outVals'] if node['type'] == 'tx' else None,
                   'fee': node['fee'] if node['type'] == 'tx' else None,
                   'z_score_tx': node['z_score_tx'] if node['type'] != 'tx' and node['type'] != 'intersection' else None,
                   'balance': address_cache.get(node['addr'], 0) if node['type'] != 'tx' and node['type'] != 'intersection' else None,
                   'z_score_balance': calculate_z_score(address_cache.get(node['addr'], 0), "balance") if node['type'] != 'tx' and node['type'] != 'intersection' else None,
                   'iqr_score_balance': calculate_iqr_score(address_cache.get(node['addr'], 0), "balance") if node['type'] != 'tx' and node['type'] != 'intersection' else None,
                 } for node in new_nodes if node['id'] in positions],
        'edges': [{'source': edge['source'], 
                   'target': edge['target'], 
                   'color': edge['color'], 
                   'type': edge['type'],
                   'size': edge['size'],
                   'z_score_tx': edge['z_score_tx'],
                   'iqr_score_tx': edge['iqr_score_tx']} 
                   for edge in new_edges_split]
    }
    return graph_data


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


def get_usd_price():
    global usd_price
    print ("Fetching bitcoin USD price")
    # Get the API key from the environment variable
    api_key = os.getenv('BTC_API_KEY')

    # API endpoint
    url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest"
    
    # Parameters for the API call
    parameters = {
        'id': '1',  # Bitcoin ID in CoinMarketCap API
        'convert': 'USD'  # Get the price in USD
    }

    headers = {
        'Accepts': 'application/json',
        'X-CMC_PRO_API_KEY': api_key,
    }

    # response = requests.get(url, headers=headers, params=parameters)

    # # Check if the request was successful
    # if response.status_code == 200:
    #     data = response.json()
    #     # Extract the USD price from the response
    #     usd_price = data['data']['1']['quote']['USD']['price']
    #     usd_price = 57717.04792391205
    #     socketio.emit('usd_price', usd_price)
    # else:
    #     # If the request failed, print the error and return None
    #     print(f"Error {response.status_code}: {response.text}")
    #     return None

    usd_price = 57717.04792391205
    socketio.emit('usd_price', usd_price)


@app.route('/static/<path:path>', methods=['GET'])
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


@app.route('/', methods=['GET'])
def index():
    return render_template('mempool.html', socket_ip=SOCKET_IP)


@app.route('/controller')
def controller():
    return render_template('controller.html', socket_ip=SOCKET_IP)


@app.route('/tx_value')
def tx_value():
    return render_template('tx_value_histogram.html', socket_ip=SOCKET_IP)


@app.route('/tx_size')
def tx_size():
    return render_template('tx_size_histogram.html', socket_ip=SOCKET_IP)


@app.route('/tx_fee')
def tx_fee():
    return render_template('tx_fee_lineGraph.html', socket_ip=SOCKET_IP)


@app.route('/tx_rate')
def tx_rate():
    return render_template('tx_rate_lineGraph.html', socket_ip=SOCKET_IP)


@app.route('/static_graph', methods=['GET'])
def static_graph():
    snapshot = request.args.get('snapshot')
    timestamp = snapshot.replace('graph_snapshot_', '').replace('.json', '')
    return render_template('static_graph.html', snapshot=snapshot, timestamp=timestamp)


@app.route('/static_histogram', methods=['GET'])
def static_histogram():
    snapshot = request.args.get('snapshot')
    histogram_type = request.args.get('histogramType', 'tx_value')
    return render_template('static_histogram.html', snapshot=snapshot, histogramType=histogram_type)


@app.route('/static_lineGraph', methods=['GET'])
def static_line_graph():
    snapshot = request.args.get('snapshot')
    line_graph_type = request.args.get('lineGraphType', 'tx_fee')
    return render_template('static_lineGraph.html', snapshot=snapshot, lineGraphType=line_graph_type)


@app.route('/save_snapshot', methods=['POST'])
def save_snapshot():
    print("SAVING SNAPSHOTS")
    graph_data = request.json
    filename = request.args.get('filename')

    # Call the function to accumulate data
    accumulate_graph_data(graph_data, filename)

    return jsonify({"status": "success"})


def accumulate_graph_data(new_data, filename):
    global graph_data_accumulated, clients_received

    with save_lock:

        # Accumulate nodes and edges if present
        if "nodes" in new_data:
            graph_data_accumulated["nodes"].extend(new_data["nodes"])
        if "edges" in new_data:
            graph_data_accumulated["edges"].extend(new_data["edges"])

        # Accumulate stats if present
        if "stats" in new_data and new_data["stats"]:
            graph_data_accumulated['stats'] = new_data['stats']

        # Accumulate histograms if present
        if "histograms" in new_data and new_data["histograms"]:
            for key, value in new_data["histograms"].items():
                if key in graph_data_accumulated["histograms"]:
                    graph_data_accumulated["histograms"][key].extend(value)
                else:
                    graph_data_accumulated["histograms"][key] = value

        # Accumulate line graphs if present
        if "lineGraphs" in new_data and new_data["lineGraphs"]:
            for key, value in new_data["lineGraphs"].items():
                if key in graph_data_accumulated["lineGraphs"]:
                    graph_data_accumulated["lineGraphs"][key].extend(value)
                else:
                    graph_data_accumulated["lineGraphs"][key] = value

        clients_received += 1
        print(f"Received data from client {clients_received}/{NUM_CLIENTS}")

        # Only save to file when all clients have submitted their data
        if clients_received == NUM_CLIENTS:
            file_path = os.path.join(app.static_folder, 'snapshots', filename)
            try:
                with open(file_path, 'w') as f:
                    print("All client data received. Writing to file...")
                    json.dump(graph_data_accumulated, f, indent=4)
                    print("Graph snapshot saved successfully.")
            except Exception as e:
                print("Error saving graph snapshot:", str(e))
            finally:
                # Reset for next snapshot
                graph_data_accumulated = {
                    "nodes": [],
                    "edges": [],
                    "stats": {},
                    "histograms": {},
                    "lineGraphs": {}
                }
                clients_received = 0


@app.route('/list_snapshots', methods=['GET'])
def list_snapshots():
    snapshots = []
    snapshots_folder = os.path.join(app.static_folder, 'snapshots')

    for file_name in os.listdir(snapshots_folder):
        if file_name.startswith("graph_snapshot_") and file_name.endswith(".json"):
            with open(os.path.join(snapshots_folder, file_name), 'r') as f:
                graph_data = json.load(f)
                stats = graph_data.get('stats', {})
                snapshots.append({
                    'file_name': file_name,
                    'stats': stats
                })
    return jsonify(snapshots)


@app.route('/snapshot_stats', methods=['GET'])
def snapshot_stats():
    snapshot = request.args.get('snapshot')
    file_path = os.path.join(app.static_folder, 'snapshots', snapshot)
    try:
        with open(file_path, 'r') as f:
            graph_data = json.load(f)
            stats = graph_data.get('stats', {})
            return render_template('snapshot_info.html', stats=stats)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@socketio.on('controller_command')
def handle_controller_command(data):
    print ("Received controller command")
    global start_visualization

    action = data.get('action')
    if action == 'startVisualization':
        with start_lock:
            start_visualization = True
            threading.Thread(target=start_ws).start()
            threading.Thread(target=periodic_broadcast).start()
            print("Visualization started.")

    elif action == 'resetGraph':
        with start_lock:
            if start_visualization:
                print("Reset graph command received.")
                socketio.emit('reload')
                reset_server_state()
    elif action == 'saveSnapshot':
          emit('controller_command', data, broadcast=True)

    elif action == 'filterNodes':
        print ("Filter nodes command received")
        filter_type = data.get('filterType')
        percentile = data.get('percentile')
        emit('filter_nodes', {'filterType': filter_type, 'percentile': percentile}, broadcast = True)

    elif action == 'cancelFilter':
        print ("Cancel filter command received")
        filter_type = data.get('filterType')
        emit('cancel_filter', {'filterType': filter_type}, broadcast = True)

    elif action == 'viewTransactionInfo':
        print ("view transaction info command received")
        filter_type = data.get('filterType')
        emit('view_transaction_info', {'filterType': filter_type}, broadcast = True)

    elif action == 'navigateTxValNode':
        direction = data.get('direction')
        print(f"Navigating TxVal Node: {direction}")
        emit('navigate_tx_val_node', {'direction': direction}, broadcast=True)

    elif action == 'navigateBalanceNode':
        direction = data.get('direction')
        print(f"Navigating Balance Node: {direction}")
        emit('navigate_balance_node', {'direction': direction}, broadcast=True)


@socketio.on('connect')
def handle_connect():
    global clients_connected
    print('Client connected') 
    emit('connection_response', {'data': 'Connected to server'})
    clients_connected += 1
    if clients_connected >= NUM_GRAPH_CLIENTS:
        get_usd_price()
        clients_connected = 0


@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')


def periodic_broadcast():
    global nodes, edges, start_visualization, numNodes
    while True:
        with start_lock:
            if not start_visualization:
                time.sleep(0.5)  # Check every second to see if the visualization has started
                continue

        with queue_lock:
            if not queue:
                continue

            if not nodes and not edges:
                print("Graph has no nodes or edges yet.")
                time.sleep(broadcast_interval)
                continue

            # Check if the number of nodes exceeds the threshold
            if numNodes > 1000:
                print("Number of nodes exceeds threshold, resetting server state.")
                reset_server_state()
                socketio.emit('reload')
                continue

            graph_data = compute_graph(nodes, edges)

            start_time = time.time()
            socketio.emit('graph_data', graph_data)
            end_time = time.time()
            emit_duration = end_time - start_time
            print ("---------------------------------------")
            print(f"Emitted to client in {emit_duration:.4f} seconds")

        time.sleep(broadcast_interval)


if __name__ == '__main__':
    load_transaction_stats()
    print("Starting Flask server")

    # socketio.run(app, host='::', port=3000)
    # socketio.run(app, host='127.0.0.1', port=3000)
    socketio.run(app, host='0.0.0.0', port=3000)