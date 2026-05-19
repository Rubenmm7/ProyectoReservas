import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// En desarrollo conecta directamente al backend para evitar problemas de proxy
// (Vite -> WSL -> Docker). En producción se deriva directamente de window.location.origin.
const SOCKET_URL = import.meta.env.PROD 
  ? window.location.origin 
  : (import.meta.env.VITE_SOCKET_URL || undefined);

const socket = io(SOCKET_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
});

export const useSocket = () => {
    const [isConnected, setIsConnected] = useState(socket.connected);

    useEffect(() => {
        const handleConnect = () => {
            setIsConnected(true);
        };

        const handleDisconnect = () => {
            setIsConnected(false);
        };

        const handleConnectError = (error) => {
            console.error('Error de conexión WebSocket:', error);
        };

        setIsConnected(socket.connected);
        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('connect_error', handleConnectError);

        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
            socket.off('connect_error', handleConnectError);
        };
    }, []);

    return { socket, isConnected };
};
