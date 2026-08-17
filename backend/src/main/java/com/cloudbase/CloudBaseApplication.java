package com.cloudbase;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CloudBaseApplication {

    public static void main(String[] args) {
        SpringApplication.run(CloudBaseApplication.class, args);
    }
}
