"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _peerjs = _interopRequireDefault(require("peerjs"));

var _uuid = require("uuid");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const EventEmitter = require('events');
/**
 * MeshPeer classes. This handle all the logic of the peer inside a mesh
 */


class MeshPeer extends EventEmitter {
  constructor(options) {
    super();

    _defineProperty(this, "options", {});

    _defineProperty(this, "id", false);

    _defineProperty(this, "roomid", false);

    _defineProperty(this, "_peer", false);

    _defineProperty(this, "_dataConnectionMap", {});

    _defineProperty(this, "_mediaConnectionMap", {});

    _defineProperty(this, "_connectionRetry", 0);

    _defineProperty(this, "_nodeidx", 0);

    _defineProperty(this, "connectNetwork", room => {
      this.roomid = room;

      this._connectToPeerJs();
    });

    _defineProperty(this, "_listenPeerOpen", () => {
      console.log("{" + this.options.log_id + "} ", "connnect to peer network with id: ", this.peerid);
      this.id = this.peerid;
      this.joined();
    });

    _defineProperty(this, "_listenPeerError", err => {
      console.log("{" + this.options.log_id + "} ", "peer on error", err, err.type);

      if (err.type === "unavailable-id") {
        if (this._nodeidx > this.options.max_mesh_peers) {
          this.emit("error", "mesh max node reached");
        } else {
          this._nodeidx = this._nodeidx + 1;

          this._connectToPeerJs();
        }
      } else {
        if (err.type === "peer-unavailable") {
          this.emit("error-peer-unavailable");
        }

        if (err.type === "disconnected" || err.type === "network" || err.type === "server-error" || err.type === "socket-error" || err.type === "socket-closed") {
          console.log("{" + this.options.log_id + "} ", "peer error", this.peerid, err.type, err);

          if (this.options.retry && this._connectionRetry < this.options.retry) {
            console.log("{" + this.options.log_id + "} ", "retrying connection ", this._connectionRetry);
            setTimeout(() => {
              this._connectToPeerJs(this.peerid);
            }, this.options.retry_interval);
          }
        } else {//peer-unavailable will come when connecting to a peer which doesn't exist
        }

        this.emit("error", err);
      } //need to handle this error
      // this.emit("error", err)

    });

    _defineProperty(this, "_listenPeerClose", () => {
      // console.log("{" + this.options.log_id + "} ", "peer close", peerid)
      // if (this.id !== peerid)
      if (this.options.retry && this._connectionRetry < this.options.retry) {
        console.log("{" + this.options.log_id + "} ", "retrying connection ", this._connectionRetry);
        setTimeout(() => {
          this._connectToPeerJs(this.peerid);
        }, this.options.retry_interval);
      } else {
        this.emit("error", "peer connection closed");
      }
    });

    _defineProperty(this, "_connectToPeerJs", () => {
      // let peerid = this.roomid + "-" + this._nodeidx
      this.peerid = (0, _uuid.v4)();
      let connection = {};

      if (this.options.connection) {
        connection = this.options.connection;
      }

      this._peer = new _peerjs.default(this.peerid, {
        debug: 1,
        ...connection
      });
      this._connectionRetry = this._connectionRetry + 1;

      try {
        this._peer.on("open", this._listenPeerOpen);

        this._peer.on("error", this._listenPeerError);

        this._peer.on("close", this._listenPeerClose);
      } catch (error) {
        console.warn(error, " when joining peer network");
        this.emit("error", error);
      }
    });

    _defineProperty(this, "joined", () => {
      console.log("{" + this.options.log_id + "} ", "emit joined", this.id);
      this.emit("joined", this.id);

      this._peer.on("connection", dc => {
        this._listenDataConnection(dc);
      });

      this._peer.on("call", mc => {
        this._listenMediaConnection(mc);
      });
    });

    _defineProperty(this, "getPeers", () => {
      return Object.keys(this._dataConnectionMap);
    });

    _defineProperty(this, "_listenDataConnection", dc => {
      dc.on("data", data => {
        console.log("{" + this.options.log_id + "} ", "data recevied by", this.id, " from ", dc.peer, data, " when listing");

        if (data.healthcheck) {
          if (data.healthcheck === "ping") {
            dc.send({
              "healthcheck": "pong"
            });
          }

          if (data.healthcheck === "pong") {
            if (dc.peer !== this.roomid) {
              this._dataConnectionMap[dc.peer] = dc;
              this.emit("peer", dc.peer);
            }
          }
        }

        if (data.message) {
          this.emit("data", data.message);
          if (data.id) dc.send({
            "message_reciept": data.id
          });
        }
      });
      dc.on("open", () => {
        console.log("{" + this.options.log_id + "} ", this.id, "data connection opened with peer when listing ", dc.peer);

        if (dc.peer !== this.roomid) {
          dc.send({
            "healthcheck": "ping"
          });
          this._dataConnectionMap[dc.peer] = dc;
        }
      });
      dc.on("close", () => {
        console.log("{" + this.options.log_id + "} ", this.id, "data connection closed with peer when listing ", dc.peer);
        delete this._dataConnectionMap[dc.peer];
      });
      dc.on("error", err => {
        console.log("{" + this.options.log_id + "} ", this.id, "data connection err with peer when listing ", err, dc.peer);
        delete this._dataConnectionMap[dc.peer];
      });
    });

    _defineProperty(this, "connectWithPeer", (other_peer_id, serve = true) => {
      let dc = this._peer.connect(other_peer_id);

      if (serve) this._serveDataConnection(dc);
      return dc;
    });

    _defineProperty(this, "_serveDataConnection", dc => {
      if (!dc) return;
      dc.on("data", data => {
        console.log("{" + this.options.log_id + "} ", "data recevied by", this.id, " from ", dc.peer, data, " when serving");

        if (data.callstopped) {
          this._handleCallStopped(data.callstopped);
        }

        if (data.callMap) {
          this._handleCallMap(data.callMap);
        }

        if (data.peerlist) {
          console.log("{" + this.options.log_id + "} ", "data.peers", data.peers);
          console.log("{" + this.options.log_id + "} ", "data.callMap", data.callMap);

          this._handleCallMap(data.callMap); //  will send peer list it has 


          if (this.options.mesh_mode == "host") {
            this.emit("sync", data.peers);
          } else {
            // need to establish data connection with other peers as well
            // in full mesh mode
            let connectedPeers = [];
            data.peers.forEach(other_peer_id => {
              if (this.id !== other_peer_id) {
                // if (!this._mediaConnectionMap[other_peer_id])
                //     if (this._getCurrentStream())
                //         this.connectStreamWithPeer(other_peer_id, this._getCurrentStream())
                if (!this._dataConnectionMap[other_peer_id]) {
                  this.connectWithPeer(other_peer_id);
                  this.on("peer", id => {
                    if (connectedPeers.indexOf(id) === -1) connectedPeers.push(id);
                    console.log("{" + this.options.log_id + "} ", "peer added", id, data.peers.length, connectedPeers.length, connectedPeers);

                    if (data.peers.length === connectedPeers.length) {
                      this.emit("sync", connectedPeers);
                    }
                  });
                  console.log("{" + this.options.log_id + "} ", "establishing new connection with ", other_peer_id);
                } else {
                  console.log("{" + this.options.log_id + "} ", "already established data connection with ", other_peer_id);
                  if (connectedPeers.indexOf(other_peer_id) === -1) connectedPeers.push(other_peer_id);

                  if (data.peers.length === connectedPeers.length) {
                    this.emit("sync", connectedPeers);
                  }
                }
              } else {
                console.log("{" + this.options.log_id + "} ", " its me!");
                if (connectedPeers.indexOf(other_peer_id) === -1) connectedPeers.push(other_peer_id);
                console.log("{" + this.options.log_id + "} ", data.peers.length, connectedPeers.length, connectedPeers);

                if (data.peers.length === connectedPeers.length) {
                  this.emit("sync", connectedPeers);
                }
              }
            });
          }
        }

        if (data.healthcheck) {
          if (data.healthcheck === "ping") {
            dc.send({
              "healthcheck": "pong"
            });
          }

          if (data.healthcheck === "pong") {
            if (dc.peer !== this.roomid) {
              this._dataConnectionMap[dc.peer] = dc;
              this.emit("peer", dc.peer);
            }
          }
        }

        if (data.message) {
          this.emit("data", data.message);
        }

        if (data.initData) {
          this._handleInitData(data.initData);
        }

        if (data.identify) {
          this.emit("peerjoined", data.identify); // if (!this._mediaConnectionMap[data.identify])
          //     if (this._getCurrentStream())
          //         this.connectStreamWithPeer(data.identify, this._getCurrentStream())
          // if (!this._dataConnectionMap[data.identify])
          //     this.connectWithPeer(data.identify)
        }

        if (data.dropped) {
          this.emit("peerdropped", data.dropped);
        }

        if (data.hostdropped) {
          this.emit("hostdropped");
        }
      });
      dc.on("open", () => {
        console.log("{" + this.options.log_id + "} ", this.id, "data connection opened with peer when serving ", dc.peer);

        if (dc.peer !== this.roomid) {
          dc.send({
            "healthcheck": "ping"
          });
          this._dataConnectionMap[dc.peer] = dc;
        }
      });
      dc.on("close", () => {
        console.log("{" + this.options.log_id + "} ", this.id, "data connection closed with peer when serving", dc.peer);
        delete this._dataConnectionMap[dc.peer];

        if (this._mediaConnectionMap[dc.peer]) {
          delete this._mediaConnectionMap[dc.peer];
        }

        if (dc.peer === this.id) {} else {
          if (dc.peer === this.roomid) {
            this.emit("hostdropped");
          } else {
            this.emit("peerdropped", dc.peer);
          }
        }
      });
      dc.on("error", err => {
        console.log("{" + this.options.log_id + "} ", this.id, "data connection err with peer", err, dc.peer);
        delete this._dataConnectionMap[dc.peer];

        if (this._mediaConnectionMap[dc.peer]) {
          delete this._mediaConnectionMap[dc.peer];
        }

        if (dc.peer === this.id) {} else {
          if (dc.peer === this.roomid) {
            this.emit("hostdropped");
          } else {
            this.emit("peerdropped", dc.peer);
          }
        }
      });
    });

    _defineProperty(this, "_handleInitData", initData => {
      Object.keys(initData).forEach(key => {
        this.emit("initData", key, initData[key]);
      });
    });

    _defineProperty(this, "_handleCallStopped", callstopped => {
      console.log("{" + this.options.log_id + "} ", "call stopped", callstopped, this._mediaConnectionMap[callstopped]);

      if (this._mediaConnectionMap[callstopped]) {
        if (this._mediaConnectionMap[callstopped].close) this._mediaConnectionMap[callstopped].close();
        delete this._mediaConnectionMap[callstopped];
      }

      this.emit("streamdrop", callstopped);
    });

    _defineProperty(this, "_handleCallMap", callMap => {
      console.log("{" + this.options.log_id + "} ", "call map length", Object.keys(callMap).length, this._getCurrentStream());

      if (this._getCurrentStream()) {
        //if a host gets dropped who is having a call, need to handle it differently
        console.log("{" + this.options.log_id + "} ", "existing mediac connection", Object.keys(this._mediaConnectionMap));

        if (this._mediaConnectionMap) {
          if (Object.keys(this._mediaConnectionMap).length === 0) {
            Object.keys(this._mediaConnectionMap).forEach(key => {
              console.log("{" + this.options.log_id + "} ", "seems host got stopped and few calls got dropped", key);

              this._handleCallStopped(key);
            });
          } else {
            Object.keys(this._mediaConnectionMap).forEach(key => {
              if (!callMap[key]) {
                console.log("{" + this.options.log_id + "} ", "seems host got stopped and few calls got dropped", key);

                this._handleCallStopped(key);
              }
            });
          }
        }

        Object.keys(callMap).forEach((key, idx) => {
          if (idx < this.options.auto_call_peer) {
            if (!this._mediaConnectionMap[key]) {
              this._mediaConnectionMap[key] = true;
              this.connectStreamWithPeer(key, this._getCurrentStream());
            }
          } else {
            // will not connect to this peer automatically
            this.emit("manual-stream", key);
          }
        });
      } else {
        Object.keys(callMap).forEach(key => {
          this.emit("manual-stream", key);
        });
      }
    });

    _defineProperty(this, "connectStreamWithPeer", (other_peer_id, stream, serve = true) => {
      let mc = this._peer.call(other_peer_id, stream);

      if (serve) this._serveMediaConnection(mc);
      return mc;
    });

    _defineProperty(this, "_serveMediaConnection", mc => {
      mc.on("stream", stream => {
        this._mediaConnectionMap[mc.peer] = true;
        console.log("{" + this.options.log_id + "} ", "stream recevied by", this.id, " from ", mc.peer, stream, " when listening");
        this.emit("stream", stream, mc.peer);
      });
      mc.on("error", error => {
        delete this._mediaConnectionMap[mc.peer];
        this.emit("streamdrop", mc.peer);
        console.log("{" + this.options.log_id + "} ", "stream error by", this.id, " from ", mc.peer, error, " when listening");
      });
      mc.on("close", () => {
        delete this._mediaConnectionMap[mc.peer];
        this.emit("streamdrop", mc.peer);
        console.log("{" + this.options.log_id + "} ", "stream close by", this.id, " from ", mc.peer, " when listening");
      });
    });

    _defineProperty(this, "_currentStream", false);

    _defineProperty(this, "_setCurrentStream", stream => {
      this._currentStream = stream;

      if (!stream) {
        Object.keys(this._mediaConnectionMap).forEach(key => {
          if (this._mediaConnectionMap[key].close) this._mediaConnectionMap[key].close();
        });
      }
    });

    _defineProperty(this, "_getCurrentStream", () => {
      return this._currentStream;
    });

    _defineProperty(this, "_listenMediaConnection", mc => {
      console.log("{" + this.options.log_id + "} ", "stream call on", this.id, " from ", mc.peer, " when listening");

      if (this._getCurrentStream()) {
        mc.answer(this._getCurrentStream());
      } else {
        console.log("{" + this.options.log_id + "} ", "stream not available");
      }

      mc.on("stream", stream => {
        this.emit("stream", stream, mc.peer);
      });
      mc.on("close", () => {
        this.emit("streamdrop", mc.peer);
        console.log("{" + this.options.log_id + "} ", "media connection close");
      });
      mc.on("error", err => {
        this.emit("streamdrop", mc.peer);
        console.log("{" + this.options.log_id + "} ", "media connection error", err);
      });
    });

    _defineProperty(this, "sendData", (peerid, data) => {
      if (this._dataConnectionMap[peerid]) {
        console.log("{" + this.options.log_id + "} ", "sending data to ", peerid);

        this._dataConnectionMap[peerid].send({
          "message": data
        });
      } else {
        console.log("{" + this.options.log_id + "} ", "data connectino doesn't existin with the peer");
      }
    });

    _defineProperty(this, "cleanup", () => {
      console.log("{" + this.options.log_id + "} ", "destroy peer");
      console.log(this._peer);

      this._peer.off("open", this._listenPeerOpen);

      this._peer.off("error", this._listenPeerError);

      this._peer.off("close", this._listenPeerClose);

      Object.keys(this._dataConnectionMap).forEach(key => {
        this._dataConnectionMap[key].close();
      });
      Object.keys(this._mediaConnectionMap).forEach(key => {
        if (this._mediaConnectionMap[key].close) this._mediaConnectionMap[key].close();
      });
      this._peer && this._peer.destroy();
      this.roomid = false;
    });

    _defineProperty(this, "_log", (msg, ...args) => {
      console.log("{" + this.options.log_id + "} " + msg, ...args);
    });

    this.options = options;
  }
  /**
   * if of the current peer in the peerjs network
   */


}

var _default = MeshPeer;
exports.default = _default;