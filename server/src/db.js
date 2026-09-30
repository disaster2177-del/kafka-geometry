import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

let connected = false;

export async function connectMongo() {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('connected', () => {
    connected = true;
    logger.info(`MongoDB connected (${mongoose.connection.host}/${mongoose.connection.name})`);
  });
  mongoose.connection.on('disconnected', () => {
    connected = false;
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));

  await mongoose.connect(config.mongo.uri, { serverSelectionTimeoutMS: 5000 });
}

export const isMongoConnected = () => connected;
