package com.cloudbase.service;

import java.util.regex.Pattern;

/**
 * Tenant-supplied values that are written into generated compose YAML (image name, image tag,
 * environment variable keys). Anything outside these grammars is rejected, so a value can never
 * break out of its YAML scalar and add keys such as host mounts or extra privileges.
 *
 * <p>Image grammar follows the Docker reference format: optional registry host[:port]/, lowercase
 * path components separated by '/', optional ':tag' and/or '@sha256:digest'.
 */
public final class ComposeInputValidator {

    private static final String COMPONENT = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
    private static final String REGISTRY = "(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*(?::[0-9]{1,5})?/)?";
    private static final String TAG = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}";
    private static final String DIGEST = "sha256:[a-f0-9]{64}";

    private static final Pattern IMAGE = Pattern.compile(
            "^" + REGISTRY + COMPONENT + "(?:/" + COMPONENT + ")*(?::" + TAG + ")?(?:@" + DIGEST + ")?$");
    private static final Pattern IMAGE_TAG = Pattern.compile("^" + TAG + "$");
    private static final Pattern ENV_KEY = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]{0,127}$");
    private static final int MAX_IMAGE_LENGTH = 255;

    private ComposeInputValidator() {
    }

    /** Image reference such as {@code nginx}, {@code nginx:1.27-alpine} or {@code ghcr.io/org/app:v1}. */
    public static String requireImage(String image) {
        if (image == null || image.length() > MAX_IMAGE_LENGTH || !IMAGE.matcher(image).matches()) {
            throw new IllegalArgumentException("Invalid image name: use a Docker reference like nginx:1.27 or org/app:v1");
        }
        return image;
    }

    public static String requireImageTag(String tag) {
        if (tag == null || !IMAGE_TAG.matcher(tag).matches()) {
            throw new IllegalArgumentException("Invalid image tag: letters, digits, '_', '.', '-' (max 128)");
        }
        return tag;
    }

    public static String requireEnvKey(String key) {
        if (key == null || !ENV_KEY.matcher(key).matches()) {
            throw new IllegalArgumentException("Invalid environment variable name: letters, digits and '_', not starting with a digit");
        }
        return key;
    }
}
