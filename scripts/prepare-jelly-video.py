"""Local matte pass for the user supplied 4-second video; no remote inference."""
import argparse
import cv2
import hashlib
import json
import numpy as np
import onnxruntime as ort
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
source, root, model = args.source, args.output, args.model
root.mkdir(parents=True, exist_ok=True)
if hashlib.md5(model.read_bytes()).hexdigest() != "8e83ca70e441ab06c318d82300c84806":
    raise ValueError("The reviewed u2netp model checksum does not match")
options = ort.SessionOptions()
options.intra_op_num_threads = 2
session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
capture = cv2.VideoCapture(str(source))
if (capture.get(cv2.CAP_PROP_FRAME_WIDTH), capture.get(cv2.CAP_PROP_FRAME_HEIGHT), capture.get(cv2.CAP_PROP_FRAME_COUNT)) != (640, 640, 97):
    raise ValueError("This crop and cycle are reviewed for the supplied 640x640, 97-frame clip only")
frames = root / "frames"
frames.mkdir(exist_ok=True)
stats = []
for index in range(96):
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f"Missing video frame {index}")
    rgb = cv2.cvtColor(cv2.resize(frame, (320, 320), interpolation=cv2.INTER_LANCZOS4), cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb /= max(rgb.max(), 1)
    tensor = (rgb - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    prediction = session.run(None, {session.get_inputs()[0].name: tensor.transpose(2, 0, 1)[None]})[0][0, 0]
    prediction = (prediction - prediction.min()) / max(prediction.max() - prediction.min(), 1e-6)
    alpha = cv2.resize(prediction, (640, 640), interpolation=cv2.INTER_CUBIC).clip(0, 1)
    # Remove low-confidence background speckles while retaining a soft silhouette.
    alpha = np.clip((alpha - .025) / .95, 0, 1)
    components, labels, component_stats, _ = cv2.connectedComponentsWithStats(np.uint8(alpha > .15))
    if components < 2:
        raise RuntimeError(f"No foreground found in video frame {index}")
    largest = 1 + int(component_stats[1:, cv2.CC_STAT_AREA].argmax())
    support = cv2.dilate(np.uint8(labels == largest), np.ones((5, 5), np.uint8))
    alpha *= support
    bounds = cv2.boundingRect(np.uint8(alpha > .1))
    # Fixed canvas preserves the original jump; no per-frame recentering or new motion.
    crop = (64, 12, 544, 576)
    x, y, width, height = crop
    a = alpha[y:y+height, x:x+width]
    colors = frame[y:y+height, x:x+width].astype(np.float32)
    # Resize premultiplied video frames to prevent old background colors bleeding
    # into the transparent edge, then restore straight alpha for the encoder.
    a_small = cv2.resize(a, (170, 180), interpolation=cv2.INTER_AREA)
    color_small = cv2.resize(colors * a[:, :, None], (170, 180), interpolation=cv2.INTER_AREA)
    color_small /= np.maximum(a_small[:, :, None], 1e-6)
    color_small[a_small < 1/255] = 0
    rgba = np.dstack((np.uint8(color_small.clip(0, 255)), np.uint8(a_small * 255)))
    encoded, png = cv2.imencode(".png", rgba)
    if not encoded:
        raise RuntimeError(f"Cannot encode video frame {index}")
    (frames / f"frame-{index:03d}.png").write_bytes(png.tobytes())
    stats.append({"frame": index, "bounds": bounds, "area": int((alpha > .5).sum())})
capture.release()
(root / "matte-stats.json").write_text(json.dumps({
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "sourceBytes": source.stat().st_size, "sourceFrames": 97,
    "frames": 96, "fps": 24, "durationMs": 4000,
    "crop": crop, "frameWidth": 170, "frameHeight": 180,
    "model": "u2netp", "modelMd5": hashlib.md5(model.read_bytes()).hexdigest(),
    "stats": stats
}, indent=2), encoding="utf8")
print(json.dumps({"frames": len(stats), "bounds": [min(s["bounds"][0] for s in stats), min(s["bounds"][1] for s in stats), max(s["bounds"][0]+s["bounds"][2] for s in stats), max(s["bounds"][1]+s["bounds"][3] for s in stats)]}))
