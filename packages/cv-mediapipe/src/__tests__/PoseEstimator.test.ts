import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PoseEstimator } from '../PoseEstimator.js';
import { FaceLandmark } from '@face/core';

describe('PoseEstimator', () => {
  const createMockLandmarks = (yawOffset = 0): FaceLandmark[] => {
    const landmarks: FaceLandmark[] = new Array(460).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));

    // Nose (index 1)
    landmarks[1] = { x: 0.5 + yawOffset, y: 0.5, z: 0 };
    // Left eye (index 33)
    landmarks[33] = { x: 0.3, y: 0.4, z: 0 };
    // Right eye (index 263)
    landmarks[263] = { x: 0.7, y: 0.4, z: 0 };
    // Left cheek (index 234)
    landmarks[234] = { x: 0.2, y: 0.5, z: 0 };
    // Right cheek (index 454)
    landmarks[454] = { x: 0.8, y: 0.5, z: 0 };
    // Chin (index 152)
    landmarks[152] = { x: 0.5, y: 0.75, z: 0 };

    return landmarks;
  };

  test('should estimate neutral pose close to 0 degrees', () => {
    const estimator = new PoseEstimator(1.0); // No smoothing
    const landmarks = createMockLandmarks(0);
    const pose = estimator.estimateRawPose(landmarks);

    assert.ok(Math.abs(pose.yaw) < 5);
    assert.ok(Math.abs(pose.roll) < 5);
  });

  test('should estimate negative yaw when nose turns left', () => {
    const estimator = new PoseEstimator(1.0);
    const landmarks = createMockLandmarks(-0.1); // Nose shifted towards left
    const pose = estimator.estimateRawPose(landmarks);

    assert.ok(pose.yaw < -10);
  });

  test('should estimate positive yaw when nose turns right', () => {
    const estimator = new PoseEstimator(1.0);
    const landmarks = createMockLandmarks(0.1); // Nose shifted towards right
    const pose = estimator.estimateRawPose(landmarks);

    assert.ok(pose.yaw > 10);
  });

  test('should smooth pose transitions using EMA', () => {
    const estimator = new PoseEstimator(0.5);
    const neutral = createMockLandmarks(0);
    const turned = createMockLandmarks(0.15);

    // Initial frame
    const pose1 = estimator.estimatePose(neutral);

    // Turned frame
    const pose2 = estimator.estimatePose(turned);

    // Smooth value should be between pose1 and raw turned value
    assert.ok(pose2.yaw > pose1.yaw);
    assert.ok(pose2.yaw < 30); // Smoothed value shouldn't jump immediately to full raw
  });
});
