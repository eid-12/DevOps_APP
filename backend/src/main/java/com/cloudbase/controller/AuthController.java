package com.cloudbase.controller;

import com.cloudbase.dto.AuthDtos.AuthResponse;
import com.cloudbase.dto.AuthDtos.LoginRequest;
import com.cloudbase.dto.AuthDtos.RegisterRequest;
import com.cloudbase.model.UserAccount;
import com.cloudbase.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/register")
    public AuthResponse register(@Valid @RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @GetMapping("/me")
    public UserAccount me(@RequestHeader("X-Auth-Token") String token) {
        return authService.resolveUser(token);
    }
}
