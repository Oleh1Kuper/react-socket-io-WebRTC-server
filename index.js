const express = require('express');
const http = require('http');
const cors = require('cors');
const app = express();
const { Server } = require('socket.io');
const { PeerServer } = require('peer');

const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const onlineUsers = {};
const videoRooms = {};

io.on('connection', (socket) => {
  console.log(`User is connected with id: ${socket.id}`);
  socket.join(socket.id);

  socket.on('login-user', (data) => loginEventHandler(socket, data));

  socket.on('chat-message', (message) => {
    chatMessageHandler(socket, message);
  });

  socket.on('video-room-create', (roomData) => videoRoomCreateHandler(socket, roomData));

  socket.on('video-room-join', (roomData) => {
    videoRoomJoinHandler(socket, roomData);
  });

  socket.on('video-room-leave', (roomData) => {
    videoRoomLeaveHandler(socket, roomData);
  });

  socket.on('disconnect', () => {
    disconnectEventHandler(socket);
  });
});

const peerServer = PeerServer({
  port: 443,
  path: '/peerjs',
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server is running on port:${PORT}`);
});

const loginEventHandler = (socket, data) => {
  socket.join('logged-users');

  onlineUsers[socket.id] = {
    userName: data.userName,
    coords: data.coords,
  };

  io.to('logged-users').emit('online-users', convertOnlineUsersToArray());
  broadcastVideoRooms();
};

const removeOnlineUser = (id) => {
  if (onlineUsers[id]) {
    delete onlineUsers[id];
  }
};

const removeUserFromVideoRoom = (socketId, roomId) => {
  const filteredUsers = videoRooms[roomId].participants
    .filter(p => p.socketId !== socketId);

  videoRooms[roomId].participants = filteredUsers;

  if (!videoRooms[roomId].participants.length) {
    delete videoRooms[roomId];
  } else {
    io.to(videoRooms[roomId].participants[0].socketId).emit('video-call-disconnect');
  }

  broadcastVideoRooms();
};

const checkIfUserIsInCall = (socket) => {
  Object.entries(videoRooms).forEach(([key, value]) => {
    const participant = value.participants.find(p => p.socketId === socket.id);

    if (participant) {
      removeUserFromVideoRoom(socket.id, key);
    }
  });
};

const disconnectEventHandler = (socket) => {
  checkIfUserIsInCall(socket);
  removeOnlineUser(socket.id);
  broadcastDisconnectedUserDeatails(socket.id);
};

const chatMessageHandler = (socket, message) => {
  const {id, receiverSocketId, content } = message;

  if (onlineUsers[receiverSocketId]) {
    io.to(receiverSocketId).to(socket.id).emit('chat-message', {
      senderSocketId: socket.id,
      content,
      id,
    });
  }
};

const videoRoomCreateHandler = (socket, roomData) => {
  const { peerId, newRoomId } = roomData;

  videoRooms[newRoomId] = {
    participants: [
      {
        socketId: socket.id,
        userName: onlineUsers[socket.id].userName,
        peerId,
      },
    ],
  };

  broadcastVideoRooms();
}

const videoRoomJoinHandler = (socket, roomData) => {
  const { roomId, peerId } = roomData;

  if (videoRooms[roomId]) {
    videoRooms[roomId].participants.forEach(participant => {
      io.to(participant.socketId).emit('video-room-init', {
        newParticipantPeerId: peerId,
      });
    });

    const newParticipant = {
      socketId: socket.id,
      userName: onlineUsers[socket.id].userName,
      peerId,
    };

    videoRooms[roomId].participants.push(newParticipant);
    broadcastVideoRooms();
  }
}

const videoRoomLeaveHandler = (socket, roomData) => {
  const { roomId } = roomData;
  
  if (videoRooms[roomId]) {
    const filteredUsers = videoRooms[roomId].participants
      .filter(p => p.socketId !== socket.id);

    videoRooms[roomId].participants = filteredUsers;
  }

  if (videoRooms[roomId].participants.length) {
    socket.to(videoRooms[roomId].participants[0].socketId)
      .emit('video-call-disconnect');
  }

  if (!videoRooms[roomId].participants.length) {
    delete videoRooms[roomId];
  }

  broadcastVideoRooms();
};

const broadcastDisconnectedUserDeatails = (disconnectedId) => {
  io.to('logged-users').emit('user-disconnected', disconnectedId);
};

const broadcastVideoRooms = () => {
  io.to('logged-users').emit('video-rooms', videoRooms);

};

const convertOnlineUsersToArray = () => {
  return Object.entries(onlineUsers)
    .map(([socketId, data]) => ({ socketId, ...data }));
};
