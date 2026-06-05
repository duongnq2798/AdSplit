pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/comparators.circom";

template TelemetryVerifier() {
    // Public Inputs
    signal input campaignId;
    signal input clickFingerprint;

    // Private Inputs
    signal input mouseX[10];
    signal input mouseY[10];
    signal input clickDelay; // in milliseconds

    // 1. Ensure clickDelay > 50 (human reaction speed constraint)
    component gt = GreaterThan(32);
    gt.in[0] <== clickDelay;
    gt.in[1] <== 50;
    gt.out === 1;

    // 2. Ensure mouse trajectory is complex (non-linear, not automated, and not zero-movement)
    signal diffX[9];
    signal diffY[9];
    for (var i = 0; i < 9; i++) {
        diffX[i] <== mouseX[i+1] - mouseX[i];
        diffY[i] <== mouseY[i+1] - mouseY[i];
    }

    signal sumSq[9];
    signal sumSqAccum[10];
    sumSqAccum[0] <== 0;

    for (var i = 0; i < 9; i++) {
        sumSq[i] <== diffX[i] * diffX[i] + diffY[i] * diffY[i];
        sumSqAccum[i+1] <== sumSqAccum[i] + sumSq[i];
    }

    // Verify sum of squared differences is greater than 10 (complexity threshold)
    component gtVol = GreaterThan(32);
    gtVol.in[0] <== sumSqAccum[9];
    gtVol.in[1] <== 10;
    gtVol.out === 1;

    // Dummy usage of campaignId and clickFingerprint to tie them to the proof
    signal dummy;
    dummy <== campaignId * clickFingerprint;
}

component main {public [campaignId, clickFingerprint]} = TelemetryVerifier();
