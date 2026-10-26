-- MySQL 8.0+ schema. Timestamps are stored in UTC.
CREATE DATABASE IF NOT EXISTS fleet_attendance
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE fleet_attendance;

CREATE TABLE users (
  id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  role ENUM('ADMIN', 'OPERATOR', 'COORDINATOR') NOT NULL DEFAULT 'OPERATOR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE vehicles (
  id CHAR(36) NOT NULL,
  fleet_number VARCHAR(64) NOT NULL,
  registration_number VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_fleet_number (fleet_number),
  UNIQUE KEY uq_vehicles_registration_number (registration_number)
) ENGINE=InnoDB;

CREATE TABLE trips (
  id CHAR(36) NOT NULL,
  vehicle_id CHAR(36) NOT NULL,
  operator_id CHAR(36) NOT NULL,
  route_name VARCHAR(150) NOT NULL,
  point_a_name VARCHAR(150) NOT NULL,
  point_b_name VARCHAR(150) NOT NULL,
  status ENUM('ACTIVE', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_trips_operator FOREIGN KEY (operator_id) REFERENCES users(id),
  KEY ix_trips_status_started_at (status, started_at),
  KEY ix_trips_vehicle_started_at (vehicle_id, started_at)
) ENGINE=InnoDB;

CREATE TABLE attendance_logs (
  -- ID is generated on the mobile device and retained for retry idempotency.
  id CHAR(36) NOT NULL,
  trip_id CHAR(36) NOT NULL,
  card_uid VARCHAR(128) NOT NULL,
  status ENUM('BOARDED', 'COMPLETED', 'INCOMPLETE') NOT NULL,
  tap_in_time DATETIME(3) NOT NULL,
  tap_in_gps JSON NULL,
  tap_out_time DATETIME(3) NULL,
  tap_out_gps JSON NULL,
  source_device_id VARCHAR(128) NULL,
  client_updated_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_attendance_trip FOREIGN KEY (trip_id) REFERENCES trips(id),
  CONSTRAINT chk_attendance_time_order CHECK (tap_out_time IS NULL OR tap_out_time >= tap_in_time),
  -- One rider/card can have exactly one attendance life-cycle per trip.
  UNIQUE KEY uq_attendance_trip_card (trip_id, card_uid),
  KEY ix_attendance_trip_status (trip_id, status),
  KEY ix_attendance_card_uid (card_uid)
) ENGINE=InnoDB;
