from __future__ import annotations

import cv2
import numpy as np

from app.answer_sheet_templates.builder import FIDUCIAL_MARGIN_MM, PAGE
from app.answer_sheet_templates.geometry import FIDUCIAL_SIZE_MM, PageSize
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.sheet_rendering.renderer import mm_length_to_px, mm_to_px

ROTATIONS = (
    None,
    cv2.ROTATE_90_CLOCKWISE,
    cv2.ROTATE_180,
    cv2.ROTATE_90_COUNTERCLOCKWISE,
)


class ScanAlignmentError(Exception):
    pass


def _fiducial_center_px(x_mm: float, y_mm: float, page: PageSize) -> list[float]:
    x0, y0 = mm_to_px(x_mm, y_mm, page)
    x1, y1 = mm_to_px(x_mm + FIDUCIAL_SIZE_MM, y_mm + FIDUCIAL_SIZE_MM, page)
    return [(x0 + x1) / 2.0, (y0 + y1) / 2.0]


def marker_long_side_ok(long_side: float, fid_px: float, touches_border: bool) -> bool:
    """A marker clipped by the image border may be as short as half the nominal size."""
    min_long_side = fid_px * 0.5 if touches_border else fid_px * 0.75
    return min_long_side <= long_side <= fid_px * 1.3


def _find_marker_in_window(
    gray_image: np.ndarray,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    target_x: float,
    target_y: float,
    fid_px: float,
) -> tuple[float, float] | None:
    img_h, img_w = gray_image.shape[:2]
    sub = gray_image[y0:y1, x0:x1]
    if int(sub.max()) - int(sub.min()) < 40:
        return None
    _, binary = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    border_margin = fid_px * 0.6
    candidates: list[tuple[float, float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 150:
            continue
        (cx, cy), (w, h), _ = cv2.minAreaRect(contour)
        if w == 0 or h == 0:
            continue
        long_side, short_side = max(w, h), min(w, h)
        bx, by, bw, bh = cv2.boundingRect(contour)
        gx, gy = x0 + bx, y0 + by
        gcx, gcy = x0 + cx, y0 + cy
        near_left = gx <= border_margin
        near_right = (gx + bw) >= img_w - border_margin
        near_top = gy <= border_margin
        near_bottom = (gy + bh) >= img_h - border_margin
        touches_border = near_left or near_right or near_top or near_bottom

        if not marker_long_side_ok(long_side, fid_px, touches_border) or area / (w * h) < 0.4:
            continue
        if not touches_border and short_side / long_side < 0.75:
            continue
        if near_left and bw < fid_px * 0.9:
            gcx = (gx + bw) - fid_px / 2.0
        elif near_right and bw < fid_px * 0.9:
            gcx = gx + fid_px / 2.0
        if near_top and bh < fid_px * 0.9:
            gcy = (gy + bh) - fid_px / 2.0
        elif near_bottom and bh < fid_px * 0.9:
            gcy = gy + fid_px / 2.0
        candidates.append((gcx, gcy))

    if not candidates:
        return None
    return min(candidates, key=lambda pt: (pt[0] - target_x) ** 2 + (pt[1] - target_y) ** 2)


def _find_alignment_pairs(
    gray_image: np.ndarray,
    dst_corners: np.ndarray,
    template_spec: TemplateSpec,
    page: PageSize = PAGE,
) -> tuple[np.ndarray, np.ndarray] | None:
    img_h, img_w = gray_image.shape[:2]
    page_w_px, page_h_px = mm_to_px(page.width_mm, page.height_mm, page)
    fid_px = mm_length_to_px(FIDUCIAL_SIZE_MM, page) * (min(img_w, img_h) / page_w_px)

    win_h, win_w = img_h // 4, img_w // 4
    windows = (
        (0, 0, win_w, win_h, 0.0, 0.0),
        (img_w - win_w, 0, img_w, win_h, float(img_w), 0.0),
        (img_w - win_w, img_h - win_h, img_w, img_h, float(img_w), float(img_h)),
        (0, img_h - win_h, win_w, img_h, 0.0, float(img_h)),
    )

    found = [
        _find_marker_in_window(gray_image, x0, y0, x1, y1, cx, cy, fid_px)
        for x0, y0, x1, y1, cx, cy in windows
    ]
    missing = [i for i, pt in enumerate(found) if pt is None]
    if not missing:
        return np.array(found, dtype=np.float32), dst_corners
    if len(missing) > 1:
        return None

    missing_idx = missing[0]
    want_left = missing_idx in (0, 3)
    for mx_mm, my_mm in template_spec.mid_marker_positions_mm:
        if (mx_mm < page.width_mm / 2.0) != want_left:
            continue
        dst_m = _fiducial_center_px(mx_mm, my_mm, page)
        tx = dst_m[0] * (img_w / page_w_px)
        ty = dst_m[1] * (img_h / page_h_px)
        x0 = max(0, int(tx - win_w // 2))
        y0 = max(0, int(ty - win_h // 2))
        x1 = min(img_w, x0 + win_w)
        y1 = min(img_h, y0 + win_h)
        src_m = _find_marker_in_window(gray_image, x0, y0, x1, y1, tx, ty, fid_px)
        if src_m is not None:
            src_pts = [pt if pt is not None else src_m for pt in found]
            dst_pts = dst_corners.copy()
            dst_pts[missing_idx] = dst_m
            return np.array(src_pts, dtype=np.float32), dst_pts
    return None


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
    border_value = (255, 255, 255) if image.ndim == 3 else 255

    best_warped: np.ndarray | None = None
    best_intensity = float("inf")

    for rotation in ROTATIONS:
        rotated = image if rotation is None else cv2.rotate(image, rotation)
        gray = cv2.cvtColor(rotated, cv2.COLOR_BGR2GRAY) if rotated.ndim == 3 else rotated
        pairs = _find_alignment_pairs(gray, dst_corners, template_spec, page)
        if pairs is None:
            continue

        src_pts, dst_pts = pairs
        matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped = cv2.warpPerspective(
            rotated,
            matrix,
            (width_px, height_px),
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=border_value,
        )
        warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY) if warped.ndim == 3 else warped
        intensity = _mid_marker_mean_intensity(warped_gray, template_spec, page)
        if intensity < best_intensity:
            best_intensity = intensity
            best_warped = warped

    if best_warped is None:
        raise ScanAlignmentError("Could not find four corner fiducials in any orientation.")
    return best_warped
