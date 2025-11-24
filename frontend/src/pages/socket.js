import { io } from "socket.io-client";

export const socket = io("https://zylo-y1ys.onrender.com", {
  transports: ["websocket"],
  reconnection: true,
});
