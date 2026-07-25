import mongoose from 'mongoose';

let connected = false;
let connecting = false;

export function isConnected(): boolean {
  return connected && mongoose.connection.readyState === 1;
}

export async function connect(): Promise<void> {
  if (isConnected()) return;
  if (connecting) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return connect();
  }

  const uri = process.env.MONGODB_URI;
  if (!uri || uri.trim() === '') {
    connected = false;
    connecting = false;
    console.log('⚠️  MONGODB_URI is not set — database unavailable (degraded mode)');
    return;
  }

  connecting = true;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    connected = true;
    connecting = false;
    console.log('✅ MongoDB connected');
  } catch (err) {
    connected = false;
    connecting = false;
    console.error('❌ MongoDB connection failed:', (err as Error).message);
    console.log('⚠️  Database unavailable (degraded mode)');
  }
}

export async function disconnect(): Promise<void> {
  if (!isConnected()) return;
  await mongoose.disconnect();
  connected = false;
  connecting = false;
}
