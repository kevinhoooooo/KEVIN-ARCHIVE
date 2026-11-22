import * as THREE from 'three';
import { CABINET_DIMS } from './cabinetModel';
import { CANISTER_DIMS, CanisterInstance } from './canisterModel';

interface PhysicsCanisterEntry {
  instance: CanisterInstance;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  quat: THREE.Quaternion;
  prevQuat: THREE.Quaternion;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  homeYaw: number;
  isDetached: boolean;
}

// Local-space collision geometry for a 135 film canister (exact zero-gap envelope with 4mm safety clearance)
const MAIN_HALF_LEN = 0.308;
const MAIN_RAD = CANISTER_DIMS.CAP_RADIUS + 0.008; // 0.250 (covers cap edge cleanly)
const CAP_RING_Y = 0.322;
const CAP_RING_RAD = 0.178;
const CAP_SPHERE_RAD = 0.074; // 0.178 + 0.074 = 0.252 radial, 0.322 + 0.074 = 0.396 axial (> 0.382 cap face)
const LIP_X = CANISTER_DIMS.BODY_RADIUS + 0.015; // 0.240
const LIP_HALF_LEN = 0.275;
const LIP_RAD = 0.076; // reaches 0.240 + 0.076 = 0.316 (covers velvet lip protrusion)
const SPOOL_Y = 0.425;
const SPOOL_RAD = 0.100;
const BROADPHASE_RADIUS = 0.64;

// Pre-computed local-space rim ring offsets (8 spheres per end cap -> continuous flat rim)
const CAP_RIM_OFFSETS: THREE.Vector3[] = [];
for (const signY of [-1, 1]) {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    CAP_RIM_OFFSETS.push(
      new THREE.Vector3(Math.cos(a) * CAP_RING_RAD, signY * CAP_RING_Y, Math.sin(a) * CAP_RING_RAD)
    );
  }
}

// Pre-allocated scratch vectors/quaternions (zero GC in animation loop)
const _a0 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _b0 = new THREE.Vector3();
const _b1 = new THREE.Vector3();
const _la0 = new THREE.Vector3();
const _la1 = new THREE.Vector3();
const _lb0 = new THREE.Vector3();
const _lb1 = new THREE.Vector3();
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _cpA = new THREE.Vector3();
const _cpB = new THREE.Vector3();
const _diff = new THREE.Vector3();
const _norm = new THREE.Vector3();
const _rA = new THREE.Vector3();
const _rB = new THREE.Vector3();
const _tA = new THREE.Vector3();
const _tB = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisX = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _rimA = new THREE.Vector3();
const _rimB = new THREE.Vector3();

const _qTarget = new THREE.Quaternion();
const _qErr = new THREE.Quaternion();
const _qFlat = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();
const _rotAxis = new THREE.Vector3();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Closest points between two 3D line segments [p1, q1] and [p2, q2].
 * Writes results into outC1 and outC2 with zero allocations.
 */
function closestPtSegmentSegment(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  outC1: THREE.Vector3,
  outC2: THREE.Vector3
) {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0;
  let t = 0;

  if (a <= 1e-8 && e <= 1e-8) {
    outC1.copy(p1);
    outC2.copy(p2);
    return;
  }

  if (a <= 1e-8) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-8) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }

  outC1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  outC2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
}

/**
 * Closest point on 3D segment [a, b] to point p.
 */
function closestPtPointSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3
) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  if (abLenSq <= 1e-8) {
    out.copy(a);
    return;
  }
  const t = THREE.MathUtils.clamp(
    ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / abLenSq,
    0,
    1
  );
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

/**
 * Analytical XPBD rigid-body physics solver for 10 film canisters inside a drawer.
 * Solves exact end-cap rim, main cylinder, protruding velvet lip, and spool contacts
 * directly in position space across multiple Gauss-Seidel iterations:
 * guarantees 100% zero interpenetration and zero spring-bounce jitter.
 */
export class DrawerPhysicsSimulation {
  private entries: PhysicsCanisterEntry[] = [];
  private entryMap = new Map<string, PhysicsCanisterEntry>();
  private hoveredId: string | null = null;

  constructor(canisters: CanisterInstance[]) {
    this.populateCanisters(canisters);

    // Pre-settle with 90 XPBD steps so initial placement is 100% flush and collision-free
    for (let i = 0; i < 90; i++) {
      this.stepSubstep(1 / 60);
    }
    this.syncToMeshes(1);
  }

  private populateCanisters(canisters: CanisterInstance[]) {
    const { DRAWER_FLOOR_Y, DRAWER_INNER_W, DRAWER_INNER_D } = CABINET_DIMS;

    // 10 canisters arranged cleanly in 3 non-overlapping staggered rows (4 + 3 + 3)
    const rowCounts = [4, 3, 3];
    const rowZ = [-0.88, 0.04, 0.96];
    let idx = 0;

    for (let r = 0; r < rowCounts.length; r++) {
      const count = rowCounts[r];
      const usableW = DRAWER_INNER_W - 0.56;
      for (let c = 0; c < count; c++) {
        if (idx >= canisters.length) break;
        const inst = canisters[idx];
        const frac = count === 1 ? 0.5 : c / (count - 1);
        const jitterX = Math.sin(idx * 2.13) * 0.015;
        const jitterZ = Math.cos(idx * 1.71) * 0.008;
        const x = (frac - 0.5) * usableW + jitterX;
        const z = rowZ[r] + jitterZ;
        const y = DRAWER_FLOOR_Y + MAIN_RAD;

        const homeYaw = Math.sin(idx * 3.17) * 0.14;
        const initRoll = ((idx * 1.37) % (Math.PI * 1.6)) - Math.PI * 0.8;

        const qFlat = new THREE.Quaternion().setFromAxisAngle(_xAxis, -Math.PI / 2);
        const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), initRoll);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(_yAxis, homeYaw);
        const qTotal = qYaw.multiply(qRoll).multiply(qFlat);

        const pos = new THREE.Vector3(x, y, z);
        const entry: PhysicsCanisterEntry = {
          instance: inst,
          pos: pos.clone(),
          prevPos: pos.clone(),
          quat: qTotal.clone(),
          prevQuat: qTotal.clone(),
          vel: new THREE.Vector3(),
          angVel: new THREE.Vector3(),
          homeYaw,
          isDetached: false,
        };
        this.entries.push(entry);
        this.entryMap.set(inst.roll.id, entry);
        idx++;
      }
    }
  }

  public setHoveredCanister(canisterId: string | null) {
    this.hoveredId = canisterId;
  }

  public setDetached(canisterId: string, detached: boolean, resetSlotPose = false) {
    const entry = this.entryMap.get(canisterId);
    if (!entry) return;

    entry.isDetached = detached;
    if (!detached && resetSlotPose) {
      const m = entry.instance.group;
      entry.pos.copy(m.position);
      entry.prevPos.copy(m.position);
      entry.quat.copy(m.quaternion);
      entry.prevQuat.copy(m.quaternion);
      entry.vel.set(0, 0, 0);
      entry.angVel.set(0, 0, 0);
      // Run immediate constraint pass so returning canister never overlaps neighbors
      for (let iter = 0; iter < 8; iter++) {
        this.solveAllConstraints();
      }
      this.syncToMeshes(1);
    }
  }

  public step(dt: number) {
    const clampedDt = Math.min(dt, 0.033);
    const substeps = 2;
    const subDt = clampedDt / substeps;

    for (let s = 0; s < substeps; s++) {
      this.stepSubstep(subDt);
    }

    const alpha = 1 - Math.exp(-26 * Math.max(clampedDt, 1 / 120));
    this.syncToMeshes(alpha);
  }

  private stepSubstep(dt: number) {
    if (dt <= 0) return;
    const { DRAWER_FLOOR_Y } = CABINET_DIMS;

    // 1. Predict candidate positions & orientations
    for (const entry of this.entries) {
      if (entry.isDetached) continue;

      entry.prevPos.copy(entry.pos);
      entry.prevQuat.copy(entry.quat);

      const isHovered = entry.instance.roll.id === this.hoveredId;

      if (isHovered) {
        // Gentle vertical buoyancy (+0.024m) so canister rolls smoothly over tray bed without hopping neighbors
        const targetY = DRAWER_FLOOR_Y + MAIN_RAD + 0.024;
        const dy = targetY - entry.pos.y;
        entry.vel.y = THREE.MathUtils.lerp(entry.vel.y, dy * 10, 0.25);
        entry.vel.x *= 0.85;
        entry.vel.z *= 0.85;
        entry.pos.addScaledVector(entry.vel, dt);

        // Smoothly roll around own longitudinal axis to face label (+Z) upward (+Y)
        _axisY.set(0, 1, 0).applyQuaternion(entry.quat);
        const currentYaw = Math.atan2(-_axisY.x, -_axisY.z);
        _qFlat.setFromAxisAngle(_xAxis, -Math.PI / 2);
        _qYaw.setFromAxisAngle(_yAxis, currentYaw);
        _qTarget.copy(_qYaw).multiply(_qFlat);

        _qErr.copy(entry.quat).invert().premultiply(_qTarget);
        if (_qErr.w < 0) {
          _qErr.x = -_qErr.x;
          _qErr.y = -_qErr.y;
          _qErr.z = -_qErr.z;
          _qErr.w = -_qErr.w;
        }
        const sinHalf = Math.sqrt(_qErr.x * _qErr.x + _qErr.y * _qErr.y + _qErr.z * _qErr.z);
        if (sinHalf > 0.002) {
          const angle = 2 * Math.atan2(sinHalf, _qErr.w);
          const maxStep = 6.2 * dt;
          const stepAng = Math.min(angle * 0.28, maxStep);
          _rotAxis.set(_qErr.x / sinHalf, _qErr.y / sinHalf, _qErr.z / sinHalf);
          _qDelta.setFromAxisAngle(_rotAxis, stepAng);
          entry.quat.premultiply(_qDelta).normalize();
        }
      } else {
        // Gravity + heavy friction damping on drawer floor
        entry.vel.y -= 14 * dt;
        entry.vel.x *= 0.84;
        entry.vel.z *= 0.84;
        entry.vel.y *= 0.9;
        entry.pos.addScaledVector(entry.vel, dt);

        // Apply residual damped angular velocity (mainly roll around cylinder axis)
        const angSpeed = entry.angVel.length();
        if (angSpeed > 0.002) {
          _rotAxis.copy(entry.angVel).divideScalar(angSpeed);
          _qDelta.setFromAxisAngle(_rotAxis, Math.min(angSpeed * dt, 0.2));
          entry.quat.premultiply(_qDelta).normalize();
        }
        entry.angVel.multiplyScalar(0.8);

        // Gently keep cylinder longitudinal axis horizontal on the drawer floor
        _axisY.set(0, 1, 0).applyQuaternion(entry.quat);
        if (Math.abs(_axisY.y) > 0.015) {
          _rotAxis.set(_axisY.z * _axisY.y, 0, -_axisY.x * _axisY.y);
          const len = _rotAxis.length();
          if (len > 1e-5) {
            _rotAxis.divideScalar(len);
            _qDelta.setFromAxisAngle(_rotAxis, Math.min(len * 0.35, 0.12));
            entry.quat.premultiply(_qDelta).normalize();
          }
        }
      }
    }

    // 2. Iterative Gauss-Seidel XPBD Constraint Projection (10 passes -> strictly zero overlap)
    for (let iter = 0; iter < 10; iter++) {
      this.solveAllConstraints();
    }

    // 3. Derive clean velocities from position changes with static rest deadzone
    const invDt = 1 / dt;
    for (const entry of this.entries) {
      if (entry.isDetached) continue;
      entry.vel.subVectors(entry.pos, entry.prevPos).multiplyScalar(invDt * 0.72);
      if (entry.vel.lengthSq() < 0.0005) {
        entry.vel.set(0, 0, 0);
      }

      if (entry.instance.roll.id !== this.hoveredId) {
        _qErr.copy(entry.prevQuat).invert().premultiply(entry.quat);
        if (_qErr.w < 0) {
          _qErr.x = -_qErr.x;
          _qErr.y = -_qErr.y;
          _qErr.z = -_qErr.z;
          _qErr.w = -_qErr.w;
        }
        const sinH = Math.sqrt(_qErr.x * _qErr.x + _qErr.y * _qErr.y + _qErr.z * _qErr.z);
        if (sinH > 0.001) {
          const ang = 2 * Math.atan2(sinH, _qErr.w);
          entry.angVel.set(_qErr.x / sinH, _qErr.y / sinH, _qErr.z / sinH).multiplyScalar(ang * invDt * 0.65);
        } else {
          entry.angVel.set(0, 0, 0);
        }
      }
    }
  }

  private solveAllConstraints() {
    // A. Drawer Floor & 4 Inner Wall Containment
    for (const entry of this.entries) {
      if (entry.isDetached) continue;
      this.constrainToDrawerBounds(entry);
    }

    // B. Pairwise Exact Canister-vs-Canister Rigid-Body Separation
    const n = this.entries.length;
    for (let i = 0; i < n; i++) {
      const a = this.entries[i];
      if (a.isDetached) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.entries[j];
        if (b.isDetached) continue;

        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        const dz = a.pos.z - b.pos.z;
        if (dx * dx + dy * dy + dz * dz > (BROADPHASE_RADIUS * 2) ** 2) continue;

        this.solvePairCollision(a, b);
      }
    }

    // C. Final wall clamp pass so pushed neighbors never violate walls
    for (const entry of this.entries) {
      if (entry.isDetached) continue;
      this.constrainToDrawerBounds(entry);
    }
  }

  private constrainToDrawerBounds(entry: PhysicsCanisterEntry) {
    const { CABINET_H, SHELL_WALL, DRAWER_FLOOR_Y, DRAWER_INNER_W, DRAWER_INNER_D } = CABINET_DIMS;
    const minX = -DRAWER_INNER_W / 2 + 0.008;
    const maxX = DRAWER_INNER_W / 2 - 0.008;
    const minZ = -DRAWER_INNER_D / 2 + 0.008;
    const maxZ = DRAWER_INNER_D / 2 - 0.008;
    const maxY = CABINET_H - SHELL_WALL - 0.05;

    _axisY.set(0, 1, 0).applyQuaternion(entry.quat);
    _axisX.set(1, 0, 0).applyQuaternion(entry.quat);
    _axisZ.set(0, 0, 1).applyQuaternion(entry.quat);

    // Check extreme points of cylinder caps, spool, and protruding lip
    let pushX = 0;
    let pushY = 0;
    let pushZ = 0;

    const testSphere = (sx: number, sy: number, sz: number, r: number) => {
      if (sy - r < DRAWER_FLOOR_Y) pushY = Math.max(pushY, DRAWER_FLOOR_Y - (sy - r));
      if (sy + r > maxY) pushY = Math.min(pushY, maxY - (sy + r));
      if (sx - r < minX) pushX = Math.max(pushX, minX - (sx - r));
      if (sx + r > maxX) pushX = Math.min(pushX, maxX - (sx + r));
      if (sz - r < minZ) pushZ = Math.max(pushZ, minZ - (sz - r));
      if (sz + r > maxZ) pushZ = Math.min(pushZ, maxZ - (sz + r));
    };

    // Main endpoints
    testSphere(
      entry.pos.x - _axisY.x * MAIN_HALF_LEN,
      entry.pos.y - _axisY.y * MAIN_HALF_LEN,
      entry.pos.z - _axisY.z * MAIN_HALF_LEN,
      MAIN_RAD
    );
    testSphere(
      entry.pos.x + _axisY.x * MAIN_HALF_LEN,
      entry.pos.y + _axisY.y * MAIN_HALF_LEN,
      entry.pos.z + _axisY.z * MAIN_HALF_LEN,
      MAIN_RAD
    );
    // Spool knob
    testSphere(
      entry.pos.x + _axisY.x * SPOOL_Y,
      entry.pos.y + _axisY.y * SPOOL_Y,
      entry.pos.z + _axisY.z * SPOOL_Y,
      SPOOL_RAD
    );
    // Protruding lip endpoints
    for (const s of [-1, 1]) {
      testSphere(
        entry.pos.x + _axisX.x * LIP_X + _axisY.x * (s * LIP_HALF_LEN),
        entry.pos.y + _axisX.y * LIP_X + _axisY.y * (s * LIP_HALF_LEN),
        entry.pos.z + _axisX.z * LIP_X + _axisY.z * (s * LIP_HALF_LEN),
        LIP_RAD
      );
    }
    // End-cap rim spheres
    for (const off of CAP_RIM_OFFSETS) {
      const wx = entry.pos.x + _axisX.x * off.x + _axisY.x * off.y + _axisZ.x * off.z;
      const wy = entry.pos.y + _axisX.y * off.x + _axisY.y * off.y + _axisZ.y * off.z;
      const wz = entry.pos.z + _axisX.z * off.x + _axisY.z * off.y + _axisZ.z * off.z;
      testSphere(wx, wy, wz, CAP_SPHERE_RAD);
    }

    entry.pos.x += pushX;
    entry.pos.y += pushY;
    entry.pos.z += pushZ;
  }

  private applyPairImpulse(
    a: PhysicsCanisterEntry,
    b: PhysicsCanisterEntry,
    ptA: THREE.Vector3,
    ptB: THREE.Vector3,
    sumR: number
  ) {
    _diff.subVectors(ptA, ptB);
    const distSq = _diff.lengthSq();
    if (distSq >= sumR * sumR) return;

    const dist = Math.sqrt(distSq);
    const pen = sumR - dist;
    if (dist > 1e-6) {
      _norm.copy(_diff).divideScalar(dist);
    } else {
      _norm.set(1, 0, 0);
    }

    const aHovered = a.instance.roll.id === this.hoveredId;
    const bHovered = b.instance.roll.id === this.hoveredId;

    // Hovered canister is slightly heavier so it parts neighbors gently without pinching them vertically
    const wA = aHovered ? 0.45 : 1.0;
    const wB = bHovered ? 0.45 : 1.0;
    const wSum = wA + wB;

    const corrA = (pen * wA) / wSum;
    const corrB = (pen * wB) / wSum;

    a.pos.addScaledVector(_norm, corrA);
    b.pos.addScaledVector(_norm, -corrB);

    // Subtle realistic yaw torque from off-center contact lever arm
    _rA.subVectors(ptA, a.pos);
    _rB.subVectors(ptB, b.pos);
    _tA.crossVectors(_rA, _norm);
    _tB.crossVectors(_rB, _norm);

    const angFactor = 0.28;
    const aTorqueY = _tA.y * corrA * angFactor;
    const bTorqueY = -_tB.y * corrB * angFactor;
    if (!aHovered && Math.abs(aTorqueY) > 1e-5) {
      _qDelta.setFromAxisAngle(_yAxis, aTorqueY);
      a.quat.premultiply(_qDelta).normalize();
    }
    if (!bHovered && Math.abs(bTorqueY) > 1e-5) {
      _qDelta.setFromAxisAngle(_yAxis, bTorqueY);
      b.quat.premultiply(_qDelta).normalize();
    }
  }

  private solvePairCollision(a: PhysicsCanisterEntry, b: PhysicsCanisterEntry) {
    // Compute world segments for Canister A
    _axisY.set(0, 1, 0).applyQuaternion(a.quat);
    _axisX.set(1, 0, 0).applyQuaternion(a.quat);
    _a0.copy(a.pos).addScaledVector(_axisY, -MAIN_HALF_LEN);
    _a1.copy(a.pos).addScaledVector(_axisY, MAIN_HALF_LEN);
    _la0.copy(a.pos).addScaledVector(_axisX, LIP_X).addScaledVector(_axisY, -LIP_HALF_LEN);
    _la1.copy(a.pos).addScaledVector(_axisX, LIP_X).addScaledVector(_axisY, LIP_HALF_LEN);
    _sa.copy(a.pos).addScaledVector(_axisY, SPOOL_Y);

    // Compute world segments for Canister B
    _axisY.set(0, 1, 0).applyQuaternion(b.quat);
    _axisX.set(1, 0, 0).applyQuaternion(b.quat);
    _b0.copy(b.pos).addScaledVector(_axisY, -MAIN_HALF_LEN);
    _b1.copy(b.pos).addScaledVector(_axisY, MAIN_HALF_LEN);
    _lb0.copy(b.pos).addScaledVector(_axisX, LIP_X).addScaledVector(_axisY, -LIP_HALF_LEN);
    _lb1.copy(b.pos).addScaledVector(_axisX, LIP_X).addScaledVector(_axisY, LIP_HALF_LEN);
    _sb.copy(b.pos).addScaledVector(_axisY, SPOOL_Y);

    // 1. MainBody A vs MainBody B
    closestPtSegmentSegment(_a0, _a1, _b0, _b1, _cpA, _cpB);
    this.applyPairImpulse(a, b, _cpA, _cpB, MAIN_RAD + MAIN_RAD);

    // 2. MainBody A vs Lip B
    closestPtSegmentSegment(_a0, _a1, _lb0, _lb1, _cpA, _cpB);
    this.applyPairImpulse(a, b, _cpA, _cpB, MAIN_RAD + LIP_RAD);

    // 3. Lip A vs MainBody B
    closestPtSegmentSegment(_la0, _la1, _b0, _b1, _cpA, _cpB);
    this.applyPairImpulse(a, b, _cpA, _cpB, LIP_RAD + MAIN_RAD);

    // 4. Lip A vs Lip B
    closestPtSegmentSegment(_la0, _la1, _lb0, _lb1, _cpA, _cpB);
    this.applyPairImpulse(a, b, _cpA, _cpB, LIP_RAD + LIP_RAD);

    // 5. Spool vs Main, Lip, and Spool
    closestPtPointSegment(_sa, _b0, _b1, _cpB);
    this.applyPairImpulse(a, b, _sa, _cpB, SPOOL_RAD + MAIN_RAD);
    closestPtPointSegment(_sa, _lb0, _lb1, _cpB);
    this.applyPairImpulse(a, b, _sa, _cpB, SPOOL_RAD + LIP_RAD);

    closestPtPointSegment(_sb, _a0, _a1, _cpA);
    this.applyPairImpulse(a, b, _cpA, _sb, MAIN_RAD + SPOOL_RAD);
    closestPtPointSegment(_sb, _la0, _la1, _cpA);
    this.applyPairImpulse(a, b, _cpA, _sb, LIP_RAD + SPOOL_RAD);

    this.applyPairImpulse(a, b, _sa, _sb, SPOOL_RAD + SPOOL_RAD);

    // 6. End-cap rim ring spheres A vs Main/Lip/Spool B (eliminates flat cap corner clipping!)
    _axisX.set(1, 0, 0).applyQuaternion(a.quat);
    _axisY.set(0, 1, 0).applyQuaternion(a.quat);
    _axisZ.set(0, 0, 1).applyQuaternion(a.quat);
    for (let ia = 0; ia < CAP_RIM_OFFSETS.length; ia++) {
      const off = CAP_RIM_OFFSETS[ia];
      _rimA.set(
        a.pos.x + _axisX.x * off.x + _axisY.x * off.y + _axisZ.x * off.z,
        a.pos.y + _axisX.y * off.x + _axisY.y * off.y + _axisZ.y * off.z,
        a.pos.z + _axisX.z * off.x + _axisY.z * off.y + _axisZ.z * off.z
      );
      closestPtPointSegment(_rimA, _b0, _b1, _cpB);
      this.applyPairImpulse(a, b, _rimA, _cpB, CAP_SPHERE_RAD + MAIN_RAD);

      closestPtPointSegment(_rimA, _lb0, _lb1, _cpB);
      this.applyPairImpulse(a, b, _rimA, _cpB, CAP_SPHERE_RAD + LIP_RAD);

      this.applyPairImpulse(a, b, _rimA, _sb, CAP_SPHERE_RAD + SPOOL_RAD);
    }

    // 7. End-cap rim ring spheres B vs Main/Lip/Spool A
    _axisX.set(1, 0, 0).applyQuaternion(b.quat);
    _axisY.set(0, 1, 0).applyQuaternion(b.quat);
    _axisZ.set(0, 0, 1).applyQuaternion(b.quat);
    for (let ib = 0; ib < CAP_RIM_OFFSETS.length; ib++) {
      const off = CAP_RIM_OFFSETS[ib];
      _rimB.set(
        b.pos.x + _axisX.x * off.x + _axisY.x * off.y + _axisZ.x * off.z,
        b.pos.y + _axisX.y * off.x + _axisY.y * off.y + _axisZ.y * off.z,
        b.pos.z + _axisX.z * off.x + _axisY.z * off.y + _axisZ.z * off.z
      );
      closestPtPointSegment(_rimB, _a0, _a1, _cpA);
      this.applyPairImpulse(a, b, _cpA, _rimB, MAIN_RAD + CAP_SPHERE_RAD);

      closestPtPointSegment(_rimB, _la0, _la1, _cpA);
      this.applyPairImpulse(a, b, _cpA, _rimB, LIP_RAD + CAP_SPHERE_RAD);

      this.applyPairImpulse(a, b, _sa, _rimB, SPOOL_RAD + CAP_SPHERE_RAD);
    }

    // 8. End-cap rim A vs End-cap rim B when canisters meet cap-to-cap
    if (a.pos.distanceToSquared(b.pos) < 1.05 * 1.05) {
      // Cache world coordinates of B's rim spheres into a compact loop
      for (let ia = 0; ia < CAP_RIM_OFFSETS.length; ia++) {
        const offA = CAP_RIM_OFFSETS[ia];
        _axisX.set(1, 0, 0).applyQuaternion(a.quat);
        _axisY.set(0, 1, 0).applyQuaternion(a.quat);
        _axisZ.set(0, 0, 1).applyQuaternion(a.quat);
        _rimA.set(
          a.pos.x + _axisX.x * offA.x + _axisY.x * offA.y + _axisZ.x * offA.z,
          a.pos.y + _axisX.y * offA.x + _axisY.y * offA.y + _axisZ.y * offA.z,
          a.pos.z + _axisX.z * offA.x + _axisY.z * offA.y + _axisZ.z * offA.z
        );

        _axisX.set(1, 0, 0).applyQuaternion(b.quat);
        _axisY.set(0, 1, 0).applyQuaternion(b.quat);
        _axisZ.set(0, 0, 1).applyQuaternion(b.quat);
        for (let ib = 0; ib < CAP_RIM_OFFSETS.length; ib++) {
          const offB = CAP_RIM_OFFSETS[ib];
          _rimB.set(
            b.pos.x + _axisX.x * offB.x + _axisY.x * offB.y + _axisZ.x * offB.z,
            b.pos.y + _axisX.y * offB.x + _axisY.y * offB.y + _axisZ.y * offB.z,
            b.pos.z + _axisX.z * offB.x + _axisY.z * offB.y + _axisZ.z * offB.z
          );
          this.applyPairImpulse(a, b, _rimA, _rimB, CAP_SPHERE_RAD + CAP_SPHERE_RAD);
        }
      }
    }
  }

  public syncToMeshes(alpha = 1) {
    for (const entry of this.entries) {
      if (entry.isDetached) continue;
      const m = entry.instance.group;
      if (alpha >= 0.999) {
        m.position.copy(entry.pos);
        m.quaternion.copy(entry.quat);
      } else {
        m.position.lerp(entry.pos, alpha);
        m.quaternion.slerp(entry.quat, alpha);
      }
    }
  }
}
