from __future__ import annotations

import cv2
import numpy as np

from app.answer_sheet_templates.builder import FIDUCIAL_MARGIN_MM, PAGE
from app.answer_sheet_templates.geometry import FIDUCIAL_SIZE_MM, PageSize
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.sheet_rendering.renderer import mm_length_to_px, mm_to_px


class ScanAlignmentError(Exception):
    pass


def _fiducial_center_px(x_mm: float, y_mm: float, page: PageSize) -> list[float]:
    x0, y0 = mm_to_px(x_mm, y_mm, page)
    x1, y1 = mm_to_px(x_mm + FIDUCIAL_SIZE_MM, y_mm + FIDUCIAL_SIZE_MM, page)
    return [(x0 + x1) / 2.0, (y0 + y1) / 2.0]


def _find_fiducial_centers(
    gray_image: np.ndarray, page: PageSize = PAGE
) -> list[tuple[float, float]]:
    _, binary = cv2.threshold(gray_image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    img_h, img_w = gray_image.shape[:2]
    page_w_px, _ = mm_to_px(page.width_mm, page.height_mm, page)
    fid_px = mm_length_to_px(FIDUCIAL_SIZE_MM, page) * (img_w / page_w_px)

    centers: list[tuple[float, float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < (fid_px * 0.1) * (fid_px * 0.7):
            continue
        (cx, cy), (w, h), _ = cv2.minAreaRect(contour)
        if w == 0 or h == 0:
            continue
        long_side, short_side = max(w, h), min(w, h)
        if not (fid_px * 0.8 <= long_side <= fid_px * 1.25) or area / (w * h) < 0.55:
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        touches_border = x <= 2 or y <= 2 or (x + bw) >= img_w - 2 or (y + bh) >= img_h - 2
        if not touches_border and short_side / long_side < 0.75:
            continue
        if x <= 2 and bw < fid_px * 0.9:
            cx = (x + bw) - fid_px / 2.0
        elif (x + bw) >= img_w - 2 and bw < fid_px * 0.9:
            cx = x + fid_px / 2.0
        if y <= 2 and bh < fid_px * 0.9:
            cy = (y + bh) - fid_px / 2.0
        elif (y + bh) >= img_h - 2 and bh < fid_px * 0.9:
            cy = y + fid_px / 2.0
        centers.append((cx, cy))
    return centers


def _order_corner_fiducials(centers: list[tuple[float, float]]) -> np.ndarray:
    if len(centers) < 4:
        raise ScanAlignmentError(f"Expected at least 4 fiducials, found {len(centers)}.")
    pts = np.array(centers, dtype=np.float32)
    sums = pts[:, 0] + pts[:, 1]
    diffs = pts[:, 0] - pts[:, 1]
    indices = [
        int(np.argmin(sums)),
        int(np.argmax(diffs)),
        int(np.argmax(sums)),
        int(np.argmin(diffs)),
    ]
    if len(set(indices)) < 4:
        raise ScanAlignmentError("Could not identify 4 distinct corner fiducials.")
    return pts[indices]


def _mid_marker_mean_intensity(
    gray_image: np.ndarray, template_spec: TemplateSpec, page: PageSize
) -> float:
    means = []
    for x_mm, y_mm in template_spec.mid_marker_positions_mm:
        x0, y0 = mm_to_px(x_mm, y_mm, page)
        x1, y1 = mm_to_px(x_mm + FIDUCIAL_SIZE_MM, y_mm + FIDUCIAL_SIZE_MM, page)
        means.append(float(gray_image[y0:y1, x0:x1].mean()))
    return float(np.mean(means))


def align_scan(
    image: np.ndarray, template_spec: TemplateSpec, page: PageSize = PAGE
) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    src_corners = _order_corner_fiducials(_find_fiducial_centers(gray, page))

    margin = FIDUCIAL_MARGIN_MM
    size = FIDUCIAL_SIZE_MM
    dst_corners = np.array(
        [
            _fiducial_center_px(margin, margin, page),
            _fiducial_center_px(page.width_mm - margin - size, margin, page),
            _fiducial_center_px(
                page.width_mm - margin - size, page.height_mm - margin - size, page
            ),
            _fiducial_center_px(margin, page.height_mm - margin - size, page),
        ],
        dtype=np.float32,
    )

    width_px, height_px = mm_to_px(page.width_mm, page.height_mm, page)
    matrix = cv2.getPerspectiveTransform(src_corners, dst_corners)
    border_value = (255, 255, 255) if image.ndim == 3 else 255
    warped = cv2.warpPerspective(
        image,
        matrix,
        (width_px, height_px),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border_value,
    )

    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY) if warped.ndim == 3 else warped
    rotated_180 = cv2.rotate(warped, cv2.ROTATE_180)
    rotated_gray = (
        cv2.cvtColor(rotated_180, cv2.COLOR_BGR2GRAY) if rotated_180.ndim == 3 else rotated_180
    )
    if _mid_marker_mean_intensity(rotated_gray, template_spec, page) < _mid_marker_mean_intensity(
        warped_gray, template_spec, page
    ):
        return rotated_180
    return warped
