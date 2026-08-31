"""Simulates the damage a real scan or phone photo does to a clean render."""

from __future__ import annotations

import cv2
import numpy as np


def apply_rotation_and_perspective(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    height, width = image.shape[:2]
    white = (255, 255, 255)

    angle_deg = float(rng.uniform(2.0, 5.0)) * (1 if rng.random() < 0.5 else -1)
    rotation_matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle_deg, 1.0)
    rotated = cv2.warpAffine(
        image, rotation_matrix, (width, height), borderMode=cv2.BORDER_CONSTANT, borderValue=white
    )

    skew_fraction = 0.015
    jitter = rng.uniform(-skew_fraction, skew_fraction, size=(4, 2))
    src_points = np.float32([[0, 0], [width, 0], [0, height], [width, height]])
    dst_points = np.float32(
        [
            [width * jitter[0, 0], height * jitter[0, 1]],
            [width * (1 + jitter[1, 0]), height * jitter[1, 1]],
            [width * jitter[2, 0], height * (1 + jitter[2, 1])],
            [width * (1 + jitter[3, 0]), height * (1 + jitter[3, 1])],
        ]
    )
    perspective_matrix = cv2.getPerspectiveTransform(src_points, dst_points)
    return cv2.warpPerspective(
        rotated,
        perspective_matrix,
        (width, height),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=white,
    )


def apply_gaussian_blur(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    sigma = float(rng.uniform(0.4, 1.2))
    return cv2.GaussianBlur(image, (5, 5), sigma)


def apply_brightness_contrast(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    brightness = float(rng.uniform(-25, 25))
    contrast = float(rng.uniform(0.85, 1.15))
    adjusted = image.astype(np.float32) * contrast + brightness
    return np.clip(adjusted, 0, 255).astype(np.uint8)


def apply_gaussian_noise(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    sigma = float(rng.uniform(2.0, 8.0))
    noise = rng.normal(0, sigma, size=image.shape)
    noisy = image.astype(np.float32) + noise
    return np.clip(noisy, 0, 255).astype(np.uint8)


def apply_jpeg_compression(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    quality = int(rng.uniform(55, 90))
    success, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not success:
        return image
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def apply_scan_artifacts(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Simulate the damage a real scan or phone photo does to a clean render.

    Order matters: physical distortions (rotation/skew, optical blur, exposure, sensor
    noise) happen before the image is ever encoded, so JPEG compression -- which is what
    actually happens last, at save time -- runs last here too.
    """
    image = apply_rotation_and_perspective(image, rng)
    image = apply_gaussian_blur(image, rng)
    image = apply_brightness_contrast(image, rng)
    image = apply_gaussian_noise(image, rng)
    image = apply_jpeg_compression(image, rng)
    return image
