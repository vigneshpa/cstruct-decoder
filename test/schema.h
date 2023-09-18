#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

#define MAX 5

#pragma pack(push, 1)

struct testa_t
{
    uint16_t field5;
    uint8_t mat[MAX][MAX];
};

struct test_t
{
    uint8_t field1;
    uint16_t field2;
    uint32_t field3;
    uint64_t field4;
    uint8_t arr[MAX];
    struct testa_t field6;
} test_instance;

#pragma pack(pop)