"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _MeshHost = _interopRequireDefault(require("./MeshHost"));

var _MeshPeer = _interopRequireDefault(require("./MeshPeer"));

var _uuid = require("uuid");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const EventEmitter = require('events');
/**
 * Mesh Network class is responsible for managing the peers inside a mesh and also the host
 * It will manage the different type of mesh modes i.e host/full mesh
 * A client application will only interact with the MeshNetwork class
 */


class MeshNetwork extends EventEmitter {
  constructor(room, options) {
    super();

    _defineProperty(this, "options", {});

    _defineProperty(this, "currentPeer", false);

    _defineProperty(this, "isjoined", false);

    _defineProperty(this, "issync", false);

    _defineProperty(this, "id", false);

    _defineProperty(this, "hostPeer", false);

    _defineProperty(this, "hostDataConnection", false);

    _defineProperty(this, "_peerlist", []);

    _defineProperty(this, "addPeer", () => {
      this.currentPeer = new _MeshPeer.default(this.options);
      this.currentPeer.connectNetwork(this.room);
      let joinTimeout = false;

      if (this.options.join_timeout !== -1) {
        joinTimeout = setTimeout(() => {
          this.isjoined = false;
          this.emit("error", "Peer timed out before joining network");
          this.cleanup(); //if we don't clean peer still tries to connect to network
        }, this.options.join_timeout);
      }

      this.currentPeer.on("joined", id => {
        joinTimeout && clearTimeout(joinTimeout);

        if (this.currentPeer) {
          this.id = id;
          this.emit("joined", id);
          this.isjoined = true;

          this._listenPeerEvents();

          this._syncMesh();
        } else {
          console.error("{" + this.options.log_id + "} ", "this is unexpected as this means cleanup was called before joined but event still fired");
          this.emit("error", "this is unexpected as this means cleanup was called before joined but event still fired");
        }
      });
      this.currentPeer.on("left", (id, err) => {
        this.isjoined = false;
        console.warn("{" + this.options.log_id + "} ", "error in mesh network", err);
        this.emit("error", err);
      });
    });

    _defineProperty(this, "_addInternalPeer", id => {
      if (this._peerlist.indexOf(id) === -1) {
        this._peerlist.push(id);

        this.emit("peerjoined", id, this._peerlist);
      }
    });

    _defineProperty(this, "_removeInternalPeer", id => {
      if (this._peerlist.indexOf(id) >= 0) {
        this._peerlist = this._peerlist.filter(p => p !== id);
        this.emit("peerdropped", id, this._peerlist);
      }
    });

    _defineProperty(this, "_listenPeerJoined", id => {
      console.log("{" + this.options.log_id + "} ", "new peer added to mesh", id);

      this._addInternalPeer(id);
    });

    _defineProperty(this, "_listenPeerDropped", id => {
      this._removeInternalPeer(id);
    });

    _defineProperty(this, "_listenSync", connectedPeers => {
      console.log("{" + this.options.log_id + "} ", "sync completed", connectedPeers);
      this.issync = true;
      this.emit("sync", connectedPeers);
      this._peerlist = []; // when a host drops a new host is created and we get all connectedPeers from that

      connectedPeers.forEach(peer => {
        this._addInternalPeer(peer);
      });
      this._syncStarted = false;
    });

    _defineProperty(this, "_listenError", err => {
      if (err.type && err.type === "peer-unavailable") {
        if (err.toString().indexOf(this.room)) {
          //if error is related to host not avaiable there is no need to emit it
          return;
        }
      }

      this.emit("error", err);
    });

    _defineProperty(this, "_listenHostDropped", () => {
      console.log("{" + this.options.log_id + "} ", "host has dropped this is a major issue need to create a new host");
      this.hostPeer = null;
      this.hostDataConnection = null;
      this.emit("sync", false);

      this._syncMesh();
    });

    _defineProperty(this, "_listenData", data => this.emit("data", data));

    _defineProperty(this, "_listenStream", (stream, id) => this.emit("stream", stream, id));

    _defineProperty(this, "_listenStreamDrop", id => this.emit("streamdrop", id));

    _defineProperty(this, "_listenInitData", (id, data) => this.emit("initData", id, data));

    _defineProperty(this, "_listenPeerEvents", () => {
      this.currentPeer.on("peerjoined", this._listenPeerJoined);
      this.currentPeer.on("peerdropped", this._listenPeerDropped);
      this.currentPeer.on("sync", this._listenSync);
      this.currentPeer.on("error", this._listenError);
      this.currentPeer.on("data", this._listenData);
      this.currentPeer.on("hostdropped", this._listenHostDropped);
      this.currentPeer.on("stream", this._listenStream);
      this.currentPeer.on("streamdrop", this._listenStreamDrop);
      this.currentPeer.on("initData", this._listenInitData);
      this.currentPeer.on("error-peer-unavailable", err => {
        let host = new _MeshHost.default(this.options);
        host.connectNetwork(this.room);
        host.on("created", peer => {
          console.log("{" + this.options.log_id + "} ", " host created ", peer);
          this.hostPeer = host;
          let dc = this.currentPeer.connectWithPeer(this.room);
          dc.on("open", () => {
            console.log("{" + this.options.log_id + "} ", "data connection opened with host");
            this.hostDataConnection = dc;
            this.emit("hostconnected", true);
            console.log("{" + this.options.log_id + "} ", "check pending messages from here 368");

            this._checkPendingMessages();
          });
        });
        host.on("exists", () => {
          console.log("{" + this.options.log_id + "} ", " host exists ");
          let dc = this.currentPeer.connectWithPeer(this.room);
          dc.on("open", () => {
            console.log("{" + this.options.log_id + "} ", "data connection opened with host");
            this.hostDataConnection = dc;
            this.emit("hostconnected", false);
            console.log("{" + this.options.log_id + "} ", "check pending messages from here 379");

            this._checkPendingMessages();
          });
        });
      });
    });

    _defineProperty(this, "_closePeerEvents", () => {
      if (!this.currentPeer) return;
      this.currentPeer.off("peerjoined", this._listenPeerJoined);
      this.currentPeer.off("peerdropped", this._listenPeerDropped);
      this.currentPeer.off("sync", this._listenSync);
      this.currentPeer.off("error", this._listenError);
      this.currentPeer.off("data", this._listenData);
      this.currentPeer.off("hostdropped", this._listenHostDropped);
      this.currentPeer.off("stream", this._listenStream);
      this.currentPeer.off("streamdrop", this._listenStreamDrop);
      this.currentPeer.off("initData", this._listenInitData);
    });

    _defineProperty(this, "isJoined", () => this.isjoined);

    _defineProperty(this, "waitToJoin", () => {
      if (this.isjoined) {
        return Promise.resolve(true);
      } else {
        return new Promise((resolve, reject) => {
          let timeout = setTimeout(() => {
            reject("timeout");
          }, this.options.join_timeout);
          this.on("joined", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    });

    _defineProperty(this, "getPeers", () => {
      if (this.options.mesh_mode === "host") {
        return this._peerlist;
      } else {
        return this.currentPeer.getPeers();
      }
    });

    _defineProperty(this, "_messageToSend", []);

    _defineProperty(this, "_checkPendingMessages", () => {
      if (this.options.mesh_mode === "host") {
        if (this._messageToSend.length > 0) {
          console.log("{" + this.options.log_id + "} ", "this._messageToSend.length", this._messageToSend.length);

          this._messageToSend.forEach(data => {
            this.hostDataConnection.send({ ...data,
              "ispending": true,
              "peerid": this.id,
              "unique": (0, _uuid.v4)()
            });
          });

          this._messageToSend = [];
        }
      }

      if (this.currentPeer._getCurrentStream()) {
        this.call(this.currentPeer._getCurrentStream());
      }

      if (this._dataToPersist) {
        this.initData(this._dataToPersist);
      }
    });

    _defineProperty(this, "send", data => {
      if (!this.isjoined || this.sync) {
        if (this._peerlist.length > 0) this._messageToSend.push({
          "data": data,
          "peerlist": this._peerlist
        });
        console.log("{" + this.options.log_id + "} ", "Can send data only once peer has synced with the network");
        return;
      }

      if (this.options.mesh_mode === "host") {
        console.log("{" + this.options.log_id + "} ", 'this.hostDataConnection', this.hostDataConnection);

        if (!this.hostDataConnection || !this.hostDataConnection.open) {
          console.log("{" + this.options.log_id + "} ", "adding data to local cache to send once host connection is established", data, this._messageToSend);
          if (this._peerlist.length > 0) this._messageToSend.push({
            "data": data,
            "peerlist": this._peerlist
          });
        } else {
          let msg_id = (0, _uuid.v4)();
          this.hostDataConnection.send({
            "message": data,
            "id": msg_id
          });

          this._messageToSend.push({
            "data": data,
            "peerlist": this._peerlist,
            "msg_id": msg_id
          });

          this.hostDataConnection.on("data", data => {
            if (data.message_reciept) {
              if (this._messageToSend) this._messageToSend.filter(msg => msg.msg_id !== data.message_reciept);
            }
          });
          this.hostDataConnection.on("error", err => {
            console.log("{" + this.options.log_id + "} ", " r", err);
          });
          this.hostDataConnection.on("close", () => {
            console.log("{" + this.options.log_id + "} ", "host data connection close");
          });
        }
      } else {
        this.getPeers().forEach(id => {
          this.currentPeer.sendData(id, data);
        });
      }
    });

    _defineProperty(this, "call", stream => {
      this.currentPeer._setCurrentStream(stream);

      if (this.hostDataConnection) {
        this.hostDataConnection.send({
          "call": true
        });
      }
    });

    _defineProperty(this, "disconnectCall", () => {
      this.currentPeer._setCurrentStream(false);

      if (this.hostDataConnection) {
        this.hostDataConnection.send({
          "call": false
        });
      }
    });

    _defineProperty(this, "_dataToPersist", false);

    _defineProperty(this, "initData", data => {
      this._dataToPersist = data;

      if (this.hostDataConnection) {
        this.hostDataConnection.send({
          "initData": data
        });
      }
    });

    _defineProperty(this, "_hostConnectionEventSetup", false);

    _defineProperty(this, "_hostDataConnection", false);

    _defineProperty(this, "_connectToHost", cb => {
      console.log("{" + this.options.log_id + "} ", "owner doesn't exist either create or connect to owner"); //doing this should ideally reduce time for mesh sync because owner will existing always except for the first host

      let dc = this.currentPeer.connectWithPeer(this.room); // if we don't add this this event get called multiple times when host disconnects. everytime a host disconects this gets call again
      // so if host disconnects 3 times, the below events get called 3 times

      dc.on("open", () => {
        console.log("{" + this.options.log_id + "} ", "data connection open with host");
        this.hostDataConnection = dc;
        this.emit("hostconnected", false);
        console.log("{" + this.options.log_id + "} ", "check pending messages from here 356");

        this._checkPendingMessages();
      }); //peer unavaiable handle above now 
    });

    _defineProperty(this, "_syncStarted", false);

    _defineProperty(this, "_syncMesh", () => {
      if (!this.currentPeer || !this.isjoined) {
        console.log("{" + this.options.log_id + "} ", "to early to call sync, first peer needs to join network");
        return true;
      }

      if (!this._syncStarted) {
        this._syncStarted = true;
        this.issync = false;
        console.log("{" + this.options.log_id + "} ", "sync mesh");

        if (!this.hostDataConnection) {
          this._connectToHost();

          this.once("hostconnected", () => {
            this.hostDataConnection.send({
              "peerlist": true,
              "existingPeers": this._peerlist
            });
          });
        } else {
          this.hostDataConnection.send({
            "peerlist": true,
            "existingPeers": this._peerlist
          });
        }

        return true;
      } else {
        console.log("{" + this.options.log_id + "} ", "sync already in progress");
        return false;
      }
    });

    _defineProperty(this, "waitToSync", () => {
      return new Promise((resolve, reject) => {
        if (!this._syncMesh()) {
          return Promise.resolve();
        } else {
          let synctimeout = setTimeout(() => {
            this._syncStarted = false;
            reject("sync timeout");
          }, this.options.sync_timeout);
          this.on("sync", peerlist => {
            this._syncStarted = false;
            clearTimeout(synctimeout);
            peerlist.forEach(peer => {
              this._addInternalPeer(peer);
            });
            resolve(peerlist);
          });
        }
      });
    });

    _defineProperty(this, "cleanup", () => {
      this._closePeerEvents();

      this.disconnectCall();
      this.isjoined = false;
      this._dataToPersist = false;
      this.currentPeer && this.currentPeer.cleanup();
      this.hostDataConnection && this.hostDataConnection.close();
      this.hostPeer && this.hostPeer.cleanup();
      this.room = false;
      this._peerlist = [];
    });

    _defineProperty(this, "_disconnectHost", () => {
      // this is just a method to test what happens to the network when host disconnects
      // this is to be used only for testing purposes     
      if (this.hostPeer) {
        this.hostPeer.cleanup();
        this.hostDataConnection = false;
        this.hostPeer = false;
      }
    });

    this.room = room;
    this.options = options;

    if (this.options.initData) {
      this.initData(this.options.initData);
    }
  }
  /**
   * instance of the current peer
   */


}

var _default = MeshNetwork;
exports.default = _default;